/**
 * Interview code came out long (8 Oct: P asked for "only the short and
 * effective version" of the code, with the explanation kept). When a
 * question looks like it asks for code, the
 * instructions get one more rule: only the asked-for logic in the code, then
 * a useful explanation. The rule itself says "if", so a question that
 * only mentions a word like "function" is answered as usual.
 */
const CODE_ASK =
  /\b(code|coding|script|scripts|query|queries|command|commands|cmd|function|program|syntax|snippet|one-liner|regex|sql|bash|shell|python|yaml|yml|json|dockerfile|docker-compose|jenkinsfile|pipeline|manifest|helm|terraform|playbook|kubectl|awk|sed|grep)\b/i

export function asksForCode(text: string): boolean {
  return CODE_ASK.test(text)
}

export const CODING_ANSWER_RULE = `If this question asks you to write code, a command, a query or a config, keep the code itself short: only the logic that was asked for, in one code block. No boilerplate, imports, setup, error handling, logging or extra features unless the question needs them, and no alternative versions. Then use focused bullet points to explain what it does, walk through the key lines, and show how to use it or give a small example when helpful. Keep the code minimal while making the explanation sufficiently developed to understand and apply it.`

/** The assistant's instructions, plus the short-code rule when it applies. */
export function withCodingRule(
  instructions: string | undefined,
  question: string
): string | undefined {
  if (!asksForCode(question)) return instructions
  return instructions
    ? `${instructions}\n\n${CODING_ANSWER_RULE}`
    : CODING_ANSWER_RULE
}
