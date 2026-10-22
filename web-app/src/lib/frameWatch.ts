/**
 * How smooth a reply looked: from sending until it finished, how soon the
 * page drew its next frame (the answer area appearing) and how many times
 * drawing stalled for more than 50 ms (a visible stutter). Logged with the
 * reply's timings.
 */
const STALL_MS = 50

let running: { stop: () => FrameStats } | null = null

export type FrameStats = { shownMs: number | undefined; stalls: number }

export function startFrameWatch(): void {
  running?.stop()
  if (typeof requestAnimationFrame === 'undefined') return
  const started = performance.now()
  let shownMs: number | undefined
  let stalls = 0
  let last = started
  let frame = 0
  const tick = (now: number) => {
    if (shownMs === undefined) shownMs = Math.round(now - started)
    const gap = now - last
    // A hidden window pauses frames altogether; that isn't a stutter
    if (gap > STALL_MS && gap < 1000) stalls++
    last = now
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
  running = {
    stop: () => {
      cancelAnimationFrame(frame)
      running = null
      return { shownMs, stalls }
    },
  }
}

/** Stops watching and returns what it saw (nothing if it wasn't running). */
export function stopFrameWatch(): FrameStats | undefined {
  return running?.stop()
}
