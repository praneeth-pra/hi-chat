import { create } from 'zustand'

/**
 * How quickly the latest answer came back, for the meter next to the model:
 * - network: sending the question until the model's first byte (the trip to
 *   the provider and back, plus the provider starting up)
 * - thinking: the model reasoning before its first answer word
 * - firstWord: network + thinking, the wait you see after sending
 * - fromStop: for a spoken question, stop talking → first answer word
 * Seconds; kept for this session only.
 */
export type LastReply = {
  network?: number
  thinking?: number
  firstWord?: number
  fromStop?: number
  model?: string
}

export const useLastReply = create<{
  last?: LastReply
  set: (last: LastReply) => void
}>((set) => ({
  last: undefined,
  set: (last) => set({ last }),
}))

/** Green under 1 s, amber under 1.5 s, red from 1.5 s. */
export const networkLevel = (s: number) =>
  s < 1 ? 'light' : s < 1.5 ? 'medium' : 'heavy'

export const formatSeconds = (s: number) =>
  s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(1)} s`
