/** Reply depth is applied at send time, including to already-saved assistants. */
const ANSWER_DETAIL_RULE = `Response style for this reply: answer the way a sharp, experienced candidate talks in an interview, easy to scan while speaking. Use these preferences in place of earlier default brevity, prose guidance, or fixed answer templates while preserving the assistant's role. Get straight to the answer. The first sentence must answer the question directly, the way you would say it out loud. Never open with an introduction, background, context-setting, an overview, prerequisites, assumptions, definitions of the obvious, "Before we dive in", "To understand this, first...", "Great question", "Sure", or a restatement of the question. Do not add a prerequisites, setup, or background section unless the question explicitly asks for one. Then keep everything short and scannable: use Markdown bullet points, or very short paragraphs of one or two sentences each. Never write a paragraph longer than two sentences. Each bullet is one complete, natural sentence (or two short ones) in a spoken voice, not a clipped label; a short bold lead-in such as "**Retries:**" is fine. Keep the depth: cover the reasoning, practical details, examples and tradeoffs a strong candidate would mention, but say each thing once and drop padding, generic preambles, and closing summaries that repeat what was already said. Do not add a fixed set of headings such as "My own work" or "Why it matters", and do not force an experience story, example, or importance section into a question that does not need it. Favor natural first-person phrasing for interview answers: "I would...", "I usually start by...", "In my last project...". For factual definitions, explain the concept directly without forcing "I" into every point. Describe past work as "I did..." only when the user's supplied context supports it; otherwise describe a proposed approach rather than inventing personal experience, projects, or results. Keep simple questions and narrow follow-ups appropriately short. Use numbered lists for sequential steps and code blocks for actual code or configuration when needed. Strictly no tabular answers: never use Markdown, HTML, ASCII, or other table layouts, including inside code blocks. Express comparisons as labeled bullet points instead. An explicit request about length, structure, or perspective in the user's current question takes precedence over these defaults; keep the no-table rule.`

export function withAnswerDetail(instructions: string | undefined): string {
  return instructions
    ? `${instructions}\n\n${ANSWER_DETAIL_RULE}`
    : ANSWER_DETAIL_RULE
}

/**
 * gpt-oss-20b follows the style rule but stops early (12 Oct: noticeably
 * shorter answers than 120B), so it gets an explicit length target.
 */
export const MEDIUM_LENGTH_RULE = `Answer length: match the question, and default to a medium-length answer. For an open interview, technical, design, behavioural or "how/why" question, give the direct opening sentence plus about 4 to 7 substantive bullets or short paragraphs with concrete details, examples and tradeoffs. Only a simple fact or a narrow yes/no follow-up gets 2 to 4 lines. Never answer an open question with just one or two sentences.`

type RequestMessage = { role: string; content?: unknown }

/** Adds the length target to the system message for gpt-oss-20b. */
export function withMediumLength<T extends RequestMessage>(
  messages: T[],
  model: string | undefined
): T[] {
  if (model !== 'openai/gpt-oss-20b') return messages
  const i = messages.findIndex(
    (m) => m.role === 'system' && typeof m.content === 'string'
  )
  if (i === -1)
    return [{ role: 'system', content: MEDIUM_LENGTH_RULE } as T, ...messages]
  return messages.map((m, j) =>
    j === i ? { ...m, content: `${m.content}\n\n${MEDIUM_LENGTH_RULE}` } : m
  )
}
