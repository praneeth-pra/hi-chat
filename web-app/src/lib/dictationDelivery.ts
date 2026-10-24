import { create } from 'zustand'
import { usePrompt } from '@/hooks/usePrompt'

/** Explicit microphone input must not depend on the interviewer listener. */
export const useDictationDelivery = create<{ pending: string[] }>(() => ({
  pending: [],
}))

/** The last dictation's text and when you stopped speaking, for timing logs. */
let lastStop: { text: string; at: number } | undefined

/**
 * When you stopped speaking, if `message` is the last dictation sent (within
 * two minutes); taken once, so a later typed question isn't timed from it.
 */
export function takeDictationStop(message: string): number | undefined {
  const stop = lastStop
  if (!stop || !message.includes(stop.text) || Date.now() - stop.at > 120_000)
    return
  lastStop = undefined
  return stop.at
}

export function deliverDictation(text: string, stoppedAt?: number) {
  if (!text.trim()) return
  if (stoppedAt) lastStop = { text: text.trim(), at: stoppedAt }
  const prompt = usePrompt.getState()
  const combined = [prompt.prompt.trim(), text.trim()].filter(Boolean).join(' ')
  prompt.setPrompt(combined)
  useDictationDelivery.setState((state) => ({
    pending:
      state.pending.length && state.pending.at(-1) === prompt.prompt
        ? [...state.pending.slice(0, -1), combined]
        : [...state.pending, combined],
  }))
}
