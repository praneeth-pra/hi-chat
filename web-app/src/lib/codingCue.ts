/**
 * Phrases an interviewer uses when the hands-on part starts. Jan then offers
 * coding mode (it never turns it on by itself): on 7 Oct "Share me that
 * query" and "Write that command" went out as questions while it was off,
 * and "Can you open this notepad?" and "Write a simple code" offered nothing.
 */
const CODING_CUE =
  /\b(share (your |the )?screen|screen ?share|notepad|text ?edit|online (compiler|editor)|open (\w+ ){0,2}(editor|compiler|ide)|write (\w+ ){0,3}(code|program|query|queries|script|command|function|syntax))\b/i

export function isCodingCue(text: string): boolean {
  return CODING_CUE.test(text)
}

/** Offer at most once in this long. */
export const CODING_OFFER_COOLDOWN_MS = 3 * 60 * 1000
