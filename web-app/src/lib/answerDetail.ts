/** Reply depth is applied at send time, including to already-saved assistants. */
const ANSWER_DETAIL_RULE = `Response detail for this reply: give a moderately detailed, well-developed answer rather than an overly concise summary. Use this reply-depth preference in place of earlier default brevity guidance. Start with the direct answer, then explain the reasoning, how it works, and relevant practical details. For substantive technical or interview questions, aim for roughly 200-350 words when useful, including a concrete example, scenario, or steps and meaningful tradeoffs. Go longer when a complete scenario or solution requires it. This is a guide, not a minimum: keep simple questions and narrow follow-ups appropriately short, and avoid repetition or filler. Preserve the assistant's role and requested output format. An explicit response-length request in the user's current question takes precedence over this default.`

export function withAnswerDetail(instructions: string | undefined): string {
  return instructions
    ? `${instructions}\n\n${ANSWER_DETAIL_RULE}`
    : ANSWER_DETAIL_RULE
}
