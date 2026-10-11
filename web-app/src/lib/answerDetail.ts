/** Reply depth is applied at send time, including to already-saved assistants. */
const ANSWER_DETAIL_RULE = `Response style for this reply: give a balanced, medium-length answer, mostly in Markdown bullet points. Use these style preferences in place of earlier default brevity or prose guidance while preserving the assistant's role. Start with the direct answer, then explain the reasoning, how it works, and relevant practical details in focused bullets. For substantive technical or interview questions, aim for roughly 150-250 words when useful, including a concrete example, scenario, or steps and meaningful tradeoffs. Avoid long essays; expand further only when explicitly requested or essential to complete the solution. This is a guide, not a minimum: keep simple questions and narrow follow-ups appropriately short, and avoid repetition or filler. Use numbered lists for sequential steps and code blocks for actual code or configuration when needed. Strictly no tabular answers: never use Markdown, HTML, ASCII, or other table layouts, including inside code blocks. Express comparisons as labeled bullet points instead. An explicit response-length request in the user's current question takes precedence over the default length; keep the no-table rule.`

export function withAnswerDetail(instructions: string | undefined): string {
  return instructions
    ? `${instructions}\n\n${ANSWER_DETAIL_RULE}`
    : ANSWER_DETAIL_RULE
}
