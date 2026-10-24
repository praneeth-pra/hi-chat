/**
 * How long gpt-oss should think before answering one question, decided in
 * code from its words (no model call, well under a millisecond). Used by
 * Auto · Instant: definitions and comparisons start almost at once on low,
 * while design, migration, debugging, coding and "in detail" questions get
 * medium. When unsure it picks medium, so a hard question is never rushed.
 */
export type QuestionEffort = 'low' | 'medium'

/** Words that mean the answer needs planning, steps or trade-offs. */
const HARD = [
  // Designing and building
  /\bdesign(?:ing)?\b/,
  /\barchitect(?:ure|ing)?\b/,
  /\bhow (?:would|will|do|can|should) (?:you|we|i) (?:build|scale|migrate|set ?up|implement|deploy|handle|secure|automate|design|troubleshoot|debug|optimi[sz]e|reduce|improve|achieve|ensure|make)\b/,
  /\bmigrat(?:e|ion|ing)\b/,
  /\bscal(?:e|ing|able|ability)\b/,
  /\bhigh(?:ly)? availab/,
  /\bdisaster recovery\b/,
  /\bmulti[- ]?(?:region|account|tenant|cloud)\b/,
  /\bzero[- ]?downtime\b/,
  // Reasoning about choices
  /\btrade[- ]?offs?\b/,
  /\bpros and cons\b/,
  /\bwhich (?:one )?(?:is|would be) better\b/,
  /\bwhen (?:would|should) (?:you|we|i) (?:use|choose|pick)\b/,
  /\bwhy (?:would|should|does|did|is|do)\b/,
  // Fixing things
  /\bdebug(?:ging)?\b/,
  /\btroubleshoot/,
  /\b(?:error|exception|failing|fails|failed|crash(?:es|ed|ing)?|not working|broken|timeout|timed out)\b/,
  /\broot cause\b/,
  // Code
  /\b(?:write|implement|code) (?:a |an |the )?(?:function|program|script|class|query|algorithm|code)\b/,
  /\balgorithm\b/,
  /\b(?:time|space) complexity\b/,
  /\bbig[- ]?o\b/,
  // Asked for depth
  /\bin detail\b/,
  /\bstep[- ]by[- ]step\b/,
  /\bwalk (?:me )?through\b/,
  /\bend[- ]to[- ]end\b/,
  /\b(?:the )?(?:process|steps|approach|strategy|plan)\b/,
  /\bexplain how\b/,
  /\bscenario\b/,
]

/** Openers that ask for a fact, a meaning or a short comparison. */
const EASY = [
  /^(?:so,? |and,? |ok(?:ay)?,? |can you (?:tell me|explain) |could you (?:tell me|explain) |tell me )?(?:what(?:'s| is| are| does)|define|full form of|meaning of|difference between|what do you mean by)\b/,
  /^(?:so,? |and,? |ok(?:ay)?,? )?(?:is|are|does|do|can) (?:an? |the )?[\w./-]+(?: [\w./-]+){0,4}\b.*\?$/,
  /^(?:so,? |and,? |ok(?:ay)?,? )?(?:name|list) (?:some|a few|the)\b/,
]

/** More than this many words, or several questions, needs planning. */
const LONG_WORDS = 28

export function questionEffort(question: string): QuestionEffort {
  const text = question
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return 'medium'
  // Code or logs pasted in: always worth thinking about
  if (/```|\n|[{};]\s*$|=>|\(\)|stack ?trace/.test(question)) return 'medium'
  if (HARD.some((re) => re.test(text))) return 'medium'
  const words = text.split(' ').length
  const questions = (text.match(/\?/g) ?? []).length
  if (words > LONG_WORDS || questions > 1 || /\band also\b/.test(text))
    return 'medium'
  if (EASY.some((re) => re.test(text))) return 'low'
  // Short and single-topic, but not clearly a definition: still quick
  return words <= 14 ? 'low' : 'medium'
}
