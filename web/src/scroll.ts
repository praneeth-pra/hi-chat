import { useCallback, useEffect, useState, type RefObject } from 'react';

const BOTTOM_THRESHOLD_PX = 80;

export const distanceFromBottom = (
  el: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>
) => el.scrollHeight - el.scrollTop - el.clientHeight;

/**
 * Tracks whether the chat is scrolled to the bottom. It never scrolls on its own:
 * sending a message or receiving a streamed reply leaves the view where it is.
 * The only movement is `scrollToBottom`, called when a chat is opened or the
 * user clicks the jump button.
 */
export function useScrollState(ref: RefObject<HTMLElement | null>) {
  const [atBottom, setAtBottom] = useState(true);

  const update = useCallback(() => {
    const el = ref.current;
    if (el) setAtBottom(distanceFromBottom(el) <= BOTTOM_THRESHOLD_PX);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [ref, update]);

  const scrollToBottom = useCallback(
    (smooth = false) => {
      const el = ref.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      update();
    },
    [ref, update]
  );

  return { atBottom, scrollToBottom, recheck: update };
}
