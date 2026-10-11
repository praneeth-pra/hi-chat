import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSpeakerTranscription } from './useSpeakerTranscription'

/** Speech overlays the composer; the user's typed draft remains untouched. */
export function useSpeakerComposerReview(prompt: string) {
  const { enabled, pending, suggestion, preview } = useSpeakerTranscription(
    useShallow((state) => ({
      enabled: state.enabled,
      pending: state.pendingQuestion,
      suggestion: state.suggestions[0],
      preview: state.preview,
    }))
  )
  const live =
    preview && (!pending || (!pending.complete && !pending.queuedQuestions))
  const text = live
    ? [pending?.text, preview.text].filter(Boolean).join(' ')
    : (pending?.text ?? suggestion ?? '')
  const key =
    pending?.id ?? (suggestion || (preview ? `clip-${preview.clipId}` : ''))
  const [selectedKey, setSelectedKey] = useState('')
  const available = enabled && !!text
  const selectedPreview =
    !!pending?.clip && selectedKey === `clip-${pending.clip}`
  useEffect(() => {
    if (selectedPreview && pending) setSelectedKey(pending.id)
  }, [selectedPreview, pending?.id])
  const showing =
    available && (!prompt || selectedKey === key || selectedPreview)
  const canSend = showing && !live && !!(pending?.text || suggestion)
  useEffect(() => {
    const state = useSpeakerTranscription.getState()
    state.setComposerReviewVisible(showing)
    return () =>
      useSpeakerTranscription.getState().setComposerReviewVisible(false)
  }, [showing, key, text, canSend, preview?.clipId, preview?.text])
  return {
    text,
    available,
    showing,
    canSend,
    queuedQuestions: pending?.queuedQuestions ?? 0,
    label: live
      ? 'Listening…'
      : pending?.followsQuestion
        ? 'Follow-up'
        : pending?.complete
          ? 'New question'
          : 'Question draft',
    select: () => setSelectedKey(key),
    back: () => setSelectedKey(''),
    next: () => {
      useSpeakerTranscription.getState().nextPendingQuestion()
      const next = useSpeakerTranscription.getState().pendingQuestion
      setSelectedKey(showing ? (next?.id ?? '') : '')
    },
    send: () => {
      if (!canSend) return
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
      const state = useSpeakerTranscription.getState()
      if (
        pending &&
        (state.pendingQuestion?.id !== pending.id ||
          state.pendingQuestion.text !== pending.text)
      )
        return
      if (!pending && preview && state.preview?.clipId !== preview.clipId)
        return
      if (pending || preview) state.discardPendingQuestion()
      else if (suggestion) state.dismissSuggestion(suggestion)
    },
  }
}
