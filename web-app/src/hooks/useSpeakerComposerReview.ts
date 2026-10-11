import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSpeakerTranscription } from './useSpeakerTranscription'
import { hasQuestionCue } from '@/lib/speakerTurnJudge'
import { SPEAKER_REVIEW_MS } from '@/lib/speakerTurns'

/** Review in the composer without copying speech into the user's typed draft. */
export function useSpeakerComposerReview(prompt: string) {
  const { enabled, pending, suggestion } = useSpeakerTranscription(
    useShallow((state) => ({
      enabled: state.enabled,
      pending: state.pendingQuestion,
      suggestion: state.suggestions[0],
    }))
  )
  const text = pending ? pending.text : suggestion
  const key = pending
    ? `${pending.id}:${pending.text}:${pending.reviewUntil ?? 0}`
    : (suggestion ?? '')
  const [expired, setExpired] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const reviewable =
    enabled && !!text && (!pending || pending.complete || hasQuestionCue(text!))
  useEffect(() => {
    if (!reviewable) return
    const timer = setTimeout(
      () => {
        setExpired(key)
        const current = useSpeakerTranscription.getState()
        if (pending) current.expirePendingReview(pending.id, pending.text)
        else if (suggestion) current.dismissSuggestion(suggestion)
      },
      Math.max(
        0,
        (pending?.reviewUntil ?? Date.now() + SPEAKER_REVIEW_MS) - Date.now()
      )
    )
    return () => clearTimeout(timer)
  }, [key, reviewable])
  const available = reviewable && expired !== key
  const showing = available && (!prompt || selectedKey === key)
  useEffect(() => {
    const current = useSpeakerTranscription.getState()
    if (current.composerReviewVisible !== showing)
      current.setComposerReviewVisible(showing)
    return () =>
      useSpeakerTranscription.getState().setComposerReviewVisible(false)
  }, [showing])
  return {
    text: text ?? '',
    available,
    showing,
    label: pending?.followsQuestion ? 'Follow-up' : 'New question',
    select: () => setSelectedKey(key),
    back: () => setSelectedKey(''),
    send: () => {
      if (
        !showing ||
        (pending?.reviewUntil != null && Date.now() >= pending.reviewUntil)
      )
        return
      const state = useSpeakerTranscription.getState()
      if (!state.enabled) return
      if (
        pending &&
        (state.pendingQuestion?.id !== pending.id ||
          state.pendingQuestion.text !== pending.text)
      )
        return
      if (pending) state.sendPendingQuestion()
      else if (suggestion) state.acceptSuggestion(suggestion)
    },
    discard: () => {
      if (!available) return
      setExpired(key)
      const state = useSpeakerTranscription.getState()
      if (pending) state.discardPendingQuestion()
      else if (suggestion) state.dismissSuggestion(suggestion)
    },
  }
}
