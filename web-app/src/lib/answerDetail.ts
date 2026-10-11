/** Reply depth is applied at send time, including to already-saved assistants. */
const ANSWER_DETAIL_RULE = `Response detail for this reply: give a balanced, medium-length answer with enough explanation to be useful. Use this reply-depth preference in place of earlier default brevity guidance. Start with the direct answer, then explain the reasoning, how it works, and relevant practical details. For substantive technical or interview questions, aim for roughly 150-250 words when useful, including a concrete example, scenario, or steps and meaningful tradeoffs. Avoid long essays; expand further only when explicitly requested or essential to complete the solution. This is a guide, not a minimum: keep simple questions and narrow follow-ups appropriately short, and avoid repetition or filler. Preserve the assistant's role and requested output format. An explicit response-length request in the user's current question takes precedence over this default.`

export function withAnswerDetail(instructions: string | undefined): string {
  return instructions
    ? `${instructions}\n\n${ANSWER_DETAIL_RULE}`
    : ANSWER_DETAIL_RULE
}
