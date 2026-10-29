import { useMemo } from 'react'
import { ThreadMessage } from '@janhq/core'
import { useAssistant } from '@/hooks/useAssistant'
import { withAnswerDetail } from '@/lib/answerDetail'
import { relevantDocuments, withDocuments } from '@/lib/assistantDocuments'
import { contextSize, formatBytes, formatTokens } from '@/lib/contextSize'
import { chatDelay } from '@/lib/replySpeed'
import { formatSeconds, networkLevel, useLastReply } from '@/lib/lastReply'
import { cn } from '@/lib/utils'

const DOT = {
  light: 'bg-green-500',
  medium: 'bg-amber-500',
  heavy: 'bg-red-500',
}

const secs = (s: number) => `${s.toFixed(s < 1 ? 2 : 1)} s`

/**
 * Next to the model: the network time of the latest answer (sending the
 * question until the model's first byte), coloured green under 1 s, amber
 * under 1.5 s, red from 1.5 s. Hovering shows the whole wait (network, thinking,
 * and for a spoken question, stop talking → first word), how much the next
 * question sends, and whether this long chat is slowing answers down.
 * Before the first answer it shows nothing.
 */
export function ContextMeter({
  messages,
  draft,
  draftImages,
}: {
  messages: ThreadMessage[]
  draft: string
  draftImages: string[]
}) {
  const assistant = useAssistant((s) => s.currentAssistant)
  const size = useMemo(
    () =>
      contextSize(
        messages,
        withAnswerDetail(
          assistant
            ? withDocuments(
                assistant.instructions,
                // Large documents send only what matches the question
                relevantDocuments(assistant.documents, draft)
              )
            : undefined
        ),
        draft,
        draftImages
      ),
    [messages, assistant, draft, draftImages]
  )
  const delay = useMemo(() => chatDelay(messages), [messages])
  const last = useLastReply((s) => s.last)
  if (last?.network === undefined) return null
  if (!messages.length && !draft.trim() && !draftImages.length) return null
  const level = networkLevel(last.network)
  const images = size.images
    ? ` and ${size.images} image${size.images > 1 ? 's' : ''} (${formatBytes(size.imageBytes)})`
    : ''
  const why =
    delay?.readingS !== undefined
      ? ` (${secs(delay.readingS)} of it the model reading the longer chat, ${secs(delay.delayS - delay.readingS)} sending it)`
      : ''
  const speed = !delay
    ? 'No slowdown measured yet: it compares with a few answers in new chats first.'
    : level === 'light'
      ? `Answers here start as fast as in a new chat (${secs(delay.recentS)} against ${secs(delay.baselineS)}).`
      : `Answers here start ${secs(delay.delayS)} later than in a new chat${why}.${level === 'heavy' ? ' A new chat (fn + N) starts fast again.' : ''}`
  const wait = [
    `Last answer: network ${formatSeconds(last.network)} (question sent → model's first byte)`,
    last.thinking !== undefined
      ? `, thinking ${formatSeconds(last.thinking)}, first word after ${formatSeconds(last.firstWord ?? last.network)}`
      : '',
    last.fromStop !== undefined
      ? `; ${formatSeconds(last.fromStop)} from when you stopped talking`
      : '',
    last.model ? ` (${last.model})` : '',
    '.',
  ].join('')
  const label = `${wait} Each question sends about ${formatTokens(size.tokens)} tokens of text${images}. ${speed}`
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="context-meter"
      className="h-7 px-1 flex items-center gap-1 text-xs text-main-view-fg/50 tabular-nums shrink-0"
    >
      <span
        className={cn('size-1.5 rounded-full', DOT[level])}
        aria-hidden="true"
      />
      {formatSeconds(last.network)}
      {size.images > 0 && (
        <span className="hidden sm:inline">· {size.images} img</span>
      )}
    </span>
  )
}
