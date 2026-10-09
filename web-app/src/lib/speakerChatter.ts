/**
 * Clips that are plainly chatter, caught in the browser so they never wait
 * for the judge. Clips are judged one at a time, so a judge call on "Okay,
 * okay." (0.4 s, sometimes 2 s or more) also delays the question after it.
 * Only clips with no content at all are caught here; anything else, even a
 * likely logistics request, is left to the judge.
 */

/** Words that carry no question on their own. */
const FILLER = new Set(
  `okay ok k yeah yea ya yes yep yup no nope nah right fine sure alright
  hmm hm mm mmm mhm hmm uh uhh um umm uhhuh huh oh ah aha so and well good
  great nice cool perfect correct exactly true gotit thanks hello
  hi hey bye goodbye sorry hold on wait one moment second sec minute just
  also anyway actually basically like see understood noted sounds
  makes sense absolutely definitely totally indeed interesting wow very
  much all of course anything else`.split(/\s+/)
)

/** Whole sentences about the call itself, not the interview. */
const CALL_CHECKS = [
  /^(hello\W*)*((can|could) you|are you able to|do you) hear me( now| properly| clearly)?$/,
  /^am i (audible|clear)( now)?$/,
  /^(is )?(it|the network|network|my voice|the audio|audio) (is )?(fine|clear|okay|ok|better|good) now$/,
  /^(your|my|the) (voice|audio|network|internet|connection) is (breaking|breaking up|not clear|lagging)( a bit)?$/,
  /^(can|could) you (please )?(stop sharing|share) (your|the) screen( now)?$/,
  /^(you can |please )?stop sharing (your |the )?screen( now)?$/,
  /^(can|could) you see my screen$/,
  /^(it was )?(nice|great|good) (talking|speaking) to you$/,
  /^(have a )?(nice|good|great) day$/,
  /^we are done$/,
]

/**
 * Lowercase words, apostrophes kept out, so "Okay," and "okay" match. Two-word
 * fillers become one word, so "you" and "it" alone don't count as filler.
 */
const words = (sentence: string) =>
  sentence
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/-/g, '')
    .replace(/\bthank you\b/g, 'thanks')
    .replace(/\bgot it\b/g, 'gotit')
    .split(/\s+/)
    .filter(Boolean)

/** Letters outside the Latin script: songs or speech in another language. */
function mostlyForeign(text: string) {
  const letters = text.match(/\p{L}/gu) ?? []
  const latin = text.match(/\p{Script=Latin}/gu) ?? []
  return letters.length >= 4 && latin.length < letters.length / 2
}

const sentences = (text: string) =>
  text
    .split(/(?<=[.?!])\s+|\.\.\.|…/)
    .map((s) => s.trim())
    .filter((s) => /\p{L}/u.test(s))

/** Why the clip is plain chatter, or null when the judge should decide. */
export function chatterReason(text: string): string | null {
  if (!/\p{L}/u.test(text)) return 'no words'
  if (mostlyForeign(text)) return 'not English'
  const parts = sentences(text)
  if (!parts.length) return 'no words'
  let filler = 0
  for (const s of parts) {
    const w = words(s)
    if (w.every((x) => FILLER.has(x))) {
      filler++
      continue
    }
    // "Yeah, are you able to hear me?": leading filler doesn't count
    const start = w.findIndex((x) => !FILLER.has(x))
    const plain = w.slice(start).join(' ')
    if (CALL_CHECKS.some((re) => re.test(plain))) continue
    return null
  }
  return filler === parts.length ? 'filler' : 'call check'
}
