/**
 * Interview code came out long (8 Oct: P asked for "only the short and
 * effective version" of the code; 13 Oct: no comments, only what is
 * required). When a question looks like it asks for code, the instructions
 * get one more rule: only the asked-for code, without comments, then a
 * couple of short bullets. The rule itself says "if", so a question that
 * only mentions a word like "function" is answered as usual.
 */
const CODE_ASK =
  /\b(code|coding|script|scripts|query|queries|command|commands|cmd|function|program|syntax|snippet|one-liner|regex|sql|bash|shell|python|yaml|yml|json|dockerfile|docker-compose|jenkinsfile|pipeline|manifest|helm|terraform|playbook|kubectl|awk|sed|grep)\b/i

export function asksForCode(text: string): boolean {
  return CODE_ASK.test(text)
}

export const CODING_ANSWER_RULE = `If this question asks you to write code, a command, a query or a config, give only the code that was asked for, in one code block. Write no comments of any kind inside the code (no //, #, /* */, docstrings or explanatory annotations). No boilerplate, imports, setup, main methods, error handling, logging, print statements, extra features or alternative versions unless the question explicitly asks for them. After the code, add at most 2 or 3 short bullets on what it does; skip line-by-line walkthroughs and usage examples unless they were asked for. For code questions this replaces the medium-length target.`

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
