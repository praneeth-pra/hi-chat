/**
 * Dictation is English only. Some engines (Cartesia Ink-2 has no language
 * setting) still write down speech in other languages, such as Hindi or
 * Telugu in the background, in that language's own script. Words with a
 * letter outside the Latin alphabet are dropped, along with punctuation
 * left standing on its own.
 *
 * Accented Latin words (café, naïve), digits and symbols are kept.
 * Other languages written in Latin letters can't be told apart this way.
 */
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u
// Punctuation left behind once its words are gone, like "। ," or "?"
const ONLY_PUNCTUATION = /^[\p{P}\p{S}]+$/u

export function englishOnly(text: string): string {
  if (!NON_LATIN_LETTER.test(text)) return text
  const words = text.split(/\s+/)
  const kept: string[] = []
  let dropped = false
  for (const word of words) {
    if (NON_LATIN_LETTER.test(word)) {
      dropped = true
      continue
    }
    // Punctuation that only followed a dropped word goes too
    if (dropped && ONLY_PUNCTUATION.test(word)) continue
    dropped = false
    kept.push(word)
  }
  return kept
    .join(' ')
    .replace(/^[,.;:!?।॥\s]+/u, '')
    .replace(/^[\p{P}\p{S}\s]+$/u, '')
    .trim()
}
