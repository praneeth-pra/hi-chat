import { ChatCompletionRole, type ThreadMessage } from '@janhq/core'
import type { SpeakerTurnDelivery } from '@/hooks/useSpeakerTranscription'

export type SpeakerChatRequest = {
  turn: SpeakerTurnDelivery
  isCurrent: () => boolean
  onThread: (threadId: string) => void
  onAnswerStart?: () => void
}

/** Never replace a typed message or an older question after the chat moved on. */
export function speakerQuestionTarget(
  messages: ThreadMessage[],
  turnId: string
) {
  const userIndex = messages.map((m) => m.role).lastIndexOf(ChatCompletionRole.User)
  const user = messages[userIndex]
  if (!user || user.metadata?.speakerTurnId !== turnId) return null
  const tail = messages.slice(userIndex + 1)
  const answer = [...tail]
    .reverse()
    .find((m) => m.role === 'assistant' && !m.metadata?.tool_calls)
  return { user, answer, context: messages.slice(0, userIndex) }
}
