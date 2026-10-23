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
  return wholeWords(target, Math.min(shown, shownRef.current))
}

/**
 * The text up to `end`, never cutting a word: a word that grew a letter at a
 * time jumped to the next line once it no longer fit, so lines jittered as
 * the answer came in. The word `end` falls in is shown whole if it has
 * arrived; one still arriving waits until it has.
 */
export function wholeWords(text: string, end: number): string {
  if (end >= text.length) return text
  if (end <= 0) return ''
  if (/\s/.test(text[end - 1])) return text.slice(0, end)
  const rest = text.slice(end).search(/\s/)
  if (rest >= 0) return text.slice(0, end + rest)
  const back = text.slice(0, end).search(/\s\S*$/)
  return back >= 0 ? text.slice(0, back + 1) : ''
}
