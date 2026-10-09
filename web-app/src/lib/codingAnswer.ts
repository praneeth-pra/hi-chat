/**
 * Interview code came out long (8 Oct: P asked for "only the short and
 * effective version" of the code, with the explanation kept). When a
 * question looks like it asks for code, or coding mode is on, the
 * instructions get one more rule: only the asked-for logic in the code, then
 * a brief explanation. The rule itself says "if", so a question that
 * only mentions a word like "function" is answered as usual.
 */
const CODE_ASK =
  /\b(code|coding|script|scripts|query|queries|command|commands|cmd|function|program|syntax|snippet|one-liner|regex|sql|bash|shell|python|yaml|yml|json|dockerfile|docker-compose|jenkinsfile|pipeline|manifest|helm|terraform|playbook|kubectl|awk|sed|grep)\b/i

export function asksForCode(text: string): boolean {
  return CODE_ASK.test(text)
}

export const CODING_ANSWER_RULE = `If this question asks you to write code, a command, a query or a config, keep the code itself short: only the logic that was asked for, in one code block. No boilerplate, imports, setup, error handling, logging or extra features unless the question needs them, and no alternative versions. Then explain it briefly: what it does and the key lines, in a few short bullets.`

/** The assistant's instructions, plus the short-code rule when it applies. */
export function withCodingRule(
  instructions: string | undefined,
  question: string,
  codingMode = false
): string | undefined {
  if (!codingMode && !asksForCode(question)) return instructions
  return instructions
    ? `${instructions}\n\n${CODING_ANSWER_RULE}`
    : CODING_ANSWER_RULE
}
