import { useRef } from 'react'

/**
 * What to show of an answer: exactly what Hi-chat shows while it keeps
 * saying (each frame it reveals more), else this page's own pace; never
 * less than already shown, never more than has arrived.
 */
export const IN_STEP_MS = 150
export function useInStep() {
  // What Hi-chat said last and when; the most this answer has shown
  const heard = useRef({ n: -1, at: 0 })
  const most = useRef(0)
  return { heard, most }
}
export function inStepLength(
  state: ReturnType<typeof useInStep>,
  fullLength: number,
  pacedLength: number,
  shown: number | undefined,
  now: number
) {
  const { heard, most } = state
  if (shown !== undefined && shown !== heard.current.n)
    heard.current = { n: shown, at: now }
  const fresh = shown !== undefined && now - heard.current.at < IN_STEP_MS
  // On its own pace it moves on from where it is, a frame's worth at a time
  // (as fast as Hi-chat catches up, at most), rather than jumping ahead
  const want = fresh
    ? shown
    : shown === undefined
      ? pacedLength
      : Math.min(pacedLength, most.current + MAX_STEP)
  most.current = Math.min(fullLength, Math.max(most.current, want))
  return { n: most.current, fresh }
}
const MAX_STEP = 40
