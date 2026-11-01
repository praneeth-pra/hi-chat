import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { UIEvent } from 'react'
import type { MirrorState } from '@/features/hichat/mirror/lib/remoteMirror'

/**
 * The conversation's scrolling: it follows Hi-chat's scroll (to the same
 * message and point in it, or the end) until you scroll here yourself, and
 * offers a jump to the latest when you are away from the end.
 */
export function useFollowScroll({
  scroll,
  msgs,
  stream,
}: Pick<MirrorState, 'scroll' | 'msgs' | 'stream'>) {
  const scroller = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const [showJump, setShowJump] = useState(false)

  // The scroll position that shows the end of the conversation at the bottom
  // of the view. Blank room follows it, so the last answer can be scrolled up
  // further, but following the end stops here rather than in the blank
  const endScroll = (el: HTMLElement) => {
    const mark = end.current
    if (!mark) return el.scrollHeight
    const top =
      mark.getBoundingClientRect().top -
      el.getBoundingClientRect().top +
      el.scrollTop
    return Math.max(0, top + 24 - el.clientHeight)
  }

  // Scrolling here yourself takes over until Hi-chat scrolls again
  const following = useRef(true)
  const placed = useRef(-1) // scrollTop this page set last

  // Follow Hi-chat's scroll: to the same message and point in it, or the end
  useLayoutEffect(() => {
    following.current = true
  }, [scroll])
  // Where the followed message sits on screen. Hi-chat sends a point in a
  // message only when it scrolls; while an answer grows its screen stays put,
  // so between scrolls this page keeps that message where it was rather than
  // working the point out again from a height that keeps changing (which
  // drifted the page with every word)
  const pinned = useRef<{ scroll: unknown; id: string; top: number } | null>(
    null
  )
  const follow = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const at = scroll
    if (following.current && at && 'id' in at) {
      const m = el.querySelector<HTMLElement>(
        `[data-mid="${CSS.escape(at.id)}"]`
      )
      if (m) {
        const box = el.getBoundingClientRect().top
        const top = m.getBoundingClientRect().top - box + el.scrollTop
        const pin = pinned.current
        // Exactly as far into it as Hi-chat is (scaled, should it wrap
        // differently here); else by fraction, from an older Hi-chat
        const into =
          at.px === undefined || !at.h
            ? at.f * m.offsetHeight - 16
            : at.px > 0
              ? at.px * (m.offsetHeight / at.h)
              : at.px
        el.scrollTop =
          pin && pin.scroll === at && pin.id === at.id
            ? top - pin.top
            : top + into
        placed.current = el.scrollTop
        pinned.current = { scroll: at, id: at.id, top: top - el.scrollTop }
        atBottom.current = false
        return
      }
    }
    if ((following.current && at) || atBottom.current) {
      el.scrollTop = endScroll(el)
      placed.current = el.scrollTop
      atBottom.current = true
      setShowJump(false)
    } else setShowJump(true)
  }, [scroll])
  useLayoutEffect(follow, [msgs, stream, scroll, follow])
  // An answer keeps growing between updates (it is revealed a little each
  // frame), so follow its height too, not only the updates
  // (watched from when it appears: on a link it is behind the code door first)
  const [contentEl, content] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = contentEl
    if (!el || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => follow())
    watch.observe(el)
    return () => watch.disconnect()
  }, [follow, contentEl])

  const jumpToLatest = () => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ top: endScroll(el), behavior: 'smooth' })
    atBottom.current = true
    setShowJump(false)
  }

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (Math.abs(el.scrollTop - placed.current) > 2) following.current = false
    // At the end, or past it in the blank room
    atBottom.current = el.scrollTop >= endScroll(el) - 40
    if (atBottom.current) setShowJump(false)
  }

  return { scroller, end, content, showJump, jumpToLatest, onScroll }
}
