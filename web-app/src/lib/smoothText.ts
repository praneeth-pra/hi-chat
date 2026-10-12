/**
 * Smooth streaming: fast providers send an answer in a few large bursts, so
 * text used to jump onto the screen. The answer is instead revealed a little
 * every frame. Nothing waits: whatever is on screen first appears the moment
 * it arrives (the opening sentence at once), and each frame shows 30% of what is still hidden, so even a
 * whole answer arriving at once is fully shown within about 0.2 seconds.
 */

/** Share of the hidden text shown each frame. */
const CATCH_UP = 0.3
/** At least this many characters per frame. */
const MIN_STEP = 3
/** A remainder this short is shown at once. */
const TAIL = 24
/** Finish the current word if it ends within this many characters. */
const WORD_LOOKAHEAD = 12

/** The opening shown the moment it arrives: up to the first sentence or line. */
const FIRST_MIN = 40
const FIRST_MAX = 160

export function firstRevealLength(text: string): number {
  if (text.length <= FIRST_MAX) return text.length
  const end = text.slice(FIRST_MIN, FIRST_MAX).search(/[.!?:](\s|$)|\n/)
  if (end !== -1) return FIRST_MIN + end + 1
  const space = text.lastIndexOf(' ', FIRST_MAX)
  return space > FIRST_MIN ? space : FIRST_MAX
}

export function nextRevealLength(text: string, shown: number): number {
  const target = text.length
  // Nothing on screen yet: show the opening immediately
  if (shown <= 0) return firstRevealLength(text)
  if (target - shown <= TAIL) return target
  let next = Math.min(
    target,
    shown + Math.max(MIN_STEP, Math.ceil((target - shown) * CATCH_UP))
  )
  const limit = Math.min(target, next + WORD_LOOKAHEAD)
  while (next < limit && !/\s/.test(text[next])) next++
  return next
}

/**
 * How much of each thread's answer is on screen. It carries the reveal over
 * from the streaming message to the saved one, so the tail of the answer
 * keeps flowing instead of appearing at once when the stream ends.
 */
const revealed = new Map<string, number>()

export const revealStore = {
  get: (threadId: string) => revealed.get(threadId),
  set: (threadId: string, length: number) => revealed.set(threadId, length),
  clear: (threadId: string) => revealed.delete(threadId),
}
