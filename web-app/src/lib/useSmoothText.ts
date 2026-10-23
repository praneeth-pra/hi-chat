import { useEffect, useRef, useState } from 'react'

/**
 * Streamed text arrives in bursts (Groq sends a whole answer in ~0.25 s);
 * this reveals it at a steady pace instead, so it flows rather than
 * landing a paragraph at a time. At least MIN_CHARS_PER_S, faster when
 * text piles up, catching up over ~CATCH_UP_MS: it never falls more than
 * about half a second behind. Text already there when it mounts is shown
 * at once.
 */
const MIN_CHARS_PER_S = 1200
const CATCH_UP_MS = 500

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
      const step = Math.max(
        1,
        Math.ceil(
          Math.max((MIN_CHARS_PER_S * dt) / 1000, (backlog * dt) / CATCH_UP_MS)
        )
      )
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
