export const THREAD_SCROLL_BEHAVIOR = {
  // FLOW: "chatgpt" behavior (keep viewport anchored to the latest user message)
  FLOW: 'flow',
  // STICKY: auto-follow streaming replies
  STICKY: 'sticky',
} as const

export type ThreadScrollBehavior =
  (typeof THREAD_SCROLL_BEHAVIOR)[keyof typeof THREAD_SCROLL_BEHAVIOR]

export const DEFAULT_THREAD_SCROLL_BEHAVIOR =
  THREAD_SCROLL_BEHAVIOR.FLOW

export const threadScrollBehaviorOptions: Array<{
  value: ThreadScrollBehavior
  translationKey: string
}> = [
  {
    value: THREAD_SCROLL_BEHAVIOR.FLOW,
    translationKey: 'settings:interface.threadScrollFlowTitle',
  },
  {
    value: THREAD_SCROLL_BEHAVIOR.STICKY,
    translationKey: 'settings:interface.threadScrollStickyTitle',
  },
]

export const isThreadScrollBehavior = (
  value: unknown
): value is ThreadScrollBehavior =>
  value === THREAD_SCROLL_BEHAVIOR.FLOW ||
  value === THREAD_SCROLL_BEHAVIOR.STICKY


/**
 * Told on the chat's scroller when a shortcut scrolls the chat (fn + Up /
 * Down in the Mac and Windows apps), so the chat stops holding the new
 * question at the top or following the answer, which would otherwise pull
 * the view back mid-scroll.
 */
export const USER_SCROLL_EVENT = 'hichat:user-scroll'
