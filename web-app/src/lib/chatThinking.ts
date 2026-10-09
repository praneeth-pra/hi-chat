/**
 * How long gpt-oss reasons before it starts the answer. Groq and Cerebras
 * default to medium; low starts the answer sooner, with a little less care
 * on hard problems.
 */
export type ChatThinking = 'low' | 'medium'

export const CHAT_THINKING_LEVELS: { value: ChatThinking; label: string }[] = [
  { value: 'low', label: 'Low (faster)' },
  { value: 'medium', label: 'Medium' },
]
export const CHAT_THINKING_STORAGE_KEY = 'chat-thinking'

export function getChatThinking(): ChatThinking {
  try {
    const saved = localStorage.getItem(CHAT_THINKING_STORAGE_KEY)
    return CHAT_THINKING_LEVELS.some((l) => l.value === saved)
      ? (saved as ChatThinking)
      : 'low'
  } catch {
    return 'low'
  }
}

export function setChatThinking(level: ChatThinking) {
  try {
    localStorage.setItem(CHAT_THINKING_STORAGE_KEY, level)
  } catch {
    // Storage blocked: the default stays in effect
  }
}

/** The reasoning level to send, for gpt-oss on Groq or Cerebras only. */
export function chatThinkingParams(
  provider: string,
  model: string | undefined
): { reasoning_effort?: ChatThinking } {
  return (provider === 'groq' || provider === 'cerebras') &&
    model?.includes('gpt-oss')
    ? { reasoning_effort: getChatThinking() }
    : {}
}
