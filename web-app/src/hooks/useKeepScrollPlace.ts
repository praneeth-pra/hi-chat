import { useEffect } from 'react'

/**
 * Keeps what you're reading still when a message above it changes height.
 *
 * Older messages are drawn only when scrolled near ([content-visibility:auto]
 * with a 480 px stand-in height). Scrolling up, each one that comes near
 * takes its real height, often 1,000-2,000 px more, and everything below it
 * moves by that much. Chromium corrects for that itself (scroll anchoring),
 * not always fully; WebKit, which the Mac app runs on, doesn't at all, so a
 * swipe up (fn + two fingers) jumped the view into the middle of an answer.
 *
 * So the chat does it itself (the scroller sets overflow-anchor: none, so
 * Chromium doesn't do it twice): when a message that was wholly above the
 * view changes height, the view moves by the same amount. Changes inside or
 * below the view (the answer streaming in) are left alone.
 */
export function useKeepScrollPlace(
  scrollContainerRef: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    const scroller = scrollContainerRef.current
    const list = scroller?.firstElementChild
    if (!scroller || !list || typeof ResizeObserver === 'undefined') return

    const heights = new WeakMap<Element, number>()
    const observer = new ResizeObserver((entries) => {
      // Top to bottom, so each check sees the corrections above it
      const changed = entries
        .map((entry) => entry.target)
        .sort((a, b) =>
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1
        )
      const viewTop = scroller.getBoundingClientRect().top
      for (const el of changed) {
        const rect = el.getBoundingClientRect()
        const before = heights.get(el)
        heights.set(el, rect.height)
        if (before === undefined || before === rect.height) continue
        // Its bottom, as it was before it changed, at or above the view's top
        if (rect.top + before <= viewTop + 1) {
          scroller.scrollTop += rect.height - before
        }
      }
    })

    const watched = new Set<Element>()
    const watchMessages = () => {
      for (const el of list.querySelectorAll(
        ':scope > [data-message-author-role]'
      )) {
        if (watched.has(el)) continue
        watched.add(el)
        heights.set(el, el.getBoundingClientRect().height)
        observer.observe(el)
      }
      for (const el of watched) {
        if (el.isConnected) continue
        watched.delete(el)
        observer.unobserve(el)
      }
    }
    watchMessages()
    // Messages come and go as children of the list; streaming only changes
    // what is inside them, which this doesn't watch
    const added = new MutationObserver(watchMessages)
    added.observe(list, { childList: true })

    return () => {
      added.disconnect()
      observer.disconnect()
    }
  }, [scrollContainerRef])
}
