/**
 * Interview code came out long (8 Oct: P asked for "only the short and
 * effective version" of the code; 13 Oct: no comments, only what is
 * required), so the instructions carry a short-code rule. It says "if" and
 * applies only when a question asks for code, so it is always there: the
 * instructions stay word for word the same from question to question, and
 * Groq and Cerebras keep reusing the chat they have already read (24 Oct:
 * adding it only to code questions made most replies read half the chat
 * again, ~0.3 s slower).
 */
export const CODING_ANSWER_RULE = `If this question asks you to write code, a command, a query or a config, give only the code that was asked for, in one code block. Write no comments of any kind inside the code (no //, #, /* */, docstrings or explanatory annotations). No boilerplate, imports, setup, main methods, error handling, logging, print statements, extra features or alternative versions unless the question explicitly asks for them. After the code, add at most 2 or 3 short bullets on what it does; skip line-by-line walkthroughs and usage examples unless they were asked for. For code questions this replaces the medium-length target.`

/** The assistant's instructions, plus the short-code rule. */
export function withCodingRule(instructions: string | undefined): string {
  return instructions
    ? `${instructions}\n\n${CODING_ANSWER_RULE}`
    : CODING_ANSWER_RULE
}
