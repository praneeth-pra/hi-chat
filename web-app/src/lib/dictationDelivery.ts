import { create } from 'zustand'
import { usePrompt } from '@/hooks/usePrompt'

/** Explicit microphone input must not depend on the interviewer listener. */
export const useDictationDelivery = create<{ pending: string[] }>(() => ({
  pending: [],
}))

export function deliverDictation(text: string) {
  if (!text.trim()) return
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
