import { useEffect, useRef, useState } from 'react'

/**
 * Streamed text arrives in uneven bursts; this reveals it at a steady pace
 * instead, a little more each frame. The pace follows the backlog (a fifth
 * of what's waiting every ~16 ms), so it never runs more than about 0.1 s
 * behind what has arrived, and a burst is spread over a few frames rather
 * than landing at once. Text already there when it mounts is shown at once.
 */
const CATCH_UP_MS = 80

export function useSmoothText(target: string, live: boolean): string {
  const [shown, setShown] = useState(target.length)
  const shownRef = useRef(target.length)
  const targetRef = useRef(target)
  const wasLive = useRef(live)
  if (live) wasLive.current = true

  // Different text (not a continuation): show it as it is
  if (!target.startsWith(targetRef.current.slice(0, shownRef.current))) {
    shownRef.current = target.length
  }
  targetRef.current = target

  const pending = shownRef.current < target.length
  const animate = pending && (live || wasLive.current)

  useEffect(() => {
    if (!animate) {
      if (shownRef.current !== shown) setShown(shownRef.current)
      return
    }
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(64, Math.max(1, now - last))
      last = now
      const total = targetRef.current.length
      const backlog = total - shownRef.current
      if (backlog <= 0) return
      const step = Math.max(1, Math.ceil((backlog * dt) / CATCH_UP_MS))
      shownRef.current = Math.min(total, shownRef.current + step)
      setShown(shownRef.current)
      if (shownRef.current < total) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, target])

  if (!animate) return target
  return target.slice(0, Math.min(shown, shownRef.current))
}
