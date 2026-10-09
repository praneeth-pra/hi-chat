/**
 * When the interviewer adds to the question just sent, or asks it again, the
 * chat replaces that question and its answer with the fuller wording. This
 * finds what to remove: the last user message and everything after it, but
 * only while that message is still the speaker question sent last (nothing
 * typed or sent since). Null means send the fuller wording as a new question.
 */
export function replaceableQuestion(
  messages: ThreadMessage[],
  lastSent: string | null
): string[] | null {
  const from = messages.map((m) => m.role).lastIndexOf('user')
  if (from < 0 || !lastSent) return null
  const text = messages[from].content?.find((c) => c.type === 'text')?.text
    ?.value
  if (text !== lastSent) return null
  return messages.slice(from).map((m) => m.id)
}
