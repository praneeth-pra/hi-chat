import { useEffect, useState } from 'react'
import {
  firstRevealLength,
  nextRevealLength,
  revealStore,
} from '@/lib/smoothText'

/**
 * Reveals `text` smoothly while it streams (see lib/smoothText.ts).
 * `streaming` is the live message; `latest` is the saved last answer of the
 * thread, which finishes a reveal the stream left unfinished. Anything else
 * (older messages, reopened chats) is shown in full straight away.
 */
export function useSmoothText(
  text: string,
  threadId: string,
  { streaming, latest }: { streaming: boolean; latest: boolean }
): string {
  const active = streaming || latest
  const [shown, setShown] = useState(() => {
    if (streaming) {
      const first = firstRevealLength(text)
      revealStore.set(threadId, first)
      return first
    }
    return (latest ? revealStore.get(threadId) : undefined) ?? text.length
  })

  // Nothing on screen yet: the first words show the moment they arrive
  const visible = active && shown === 0 ? firstRevealLength(text) : shown

  useEffect(() => {
    if (!active) return
    if (shown === 0 && text.length) {
      revealStore.set(threadId, visible)
      setShown(visible)
      return
    }
    if (shown >= text.length) {
      if (!streaming) revealStore.clear(threadId)
      return
    }
    const frame = requestAnimationFrame(() =>
      setShown((current) => {
        const next = nextRevealLength(text, current)
        revealStore.set(threadId, next)
        return next
      })
    )
    return () => cancelAnimationFrame(frame)
  }, [active, streaming, shown, visible, text, threadId])

  return active && visible < text.length ? text.slice(0, visible) : text
}
