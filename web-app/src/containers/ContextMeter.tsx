import { useMemo } from 'react'
import { ThreadMessage } from '@janhq/core'
import { useAssistant } from '@/hooks/useAssistant'
import { withAnswerDetail } from '@/lib/answerDetail'
import { withDocuments } from '@/lib/assistantDocuments'
import { contextSize, formatBytes, formatTokens } from '@/lib/contextSize'
import { cn } from '@/lib/utils'

const DOT = {
  light: 'bg-green-500',
  medium: 'bg-amber-500',
  heavy: 'bg-red-500',
}
const SPEED = {
  light: 'Answers stay fast.',
  medium: 'Answers are a little slower.',
  heavy: 'Answers are noticeably slower: a new chat (fn + N) starts light.',
}

/**
 * Next to the model: how much the next question sends, and whether the chat
 * is getting heavy (mostly images, which go again with every question).
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
            ? withDocuments(assistant.instructions, assistant.documents)
            : undefined
        ),
        draft,
        draftImages
      ),
    [messages, assistant, draft, draftImages]
  )
  if (!messages.length && !draft.trim() && !draftImages.length) return null
  const images = size.images
    ? ` and ${size.images} image${size.images > 1 ? 's' : ''} (${formatBytes(size.imageBytes)})`
    : ''
  const label = `Each question sends about ${formatTokens(size.tokens)} tokens of text (${formatTokens(size.baseTokens)} of them your assistant's instructions and documents, sent in every chat)${images}. ${SPEED[size.level]}`
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="context-meter"
      className="h-7 px-1 flex items-center gap-1 text-xs text-main-view-fg/50 tabular-nums shrink-0"
    >
      <span
        className={cn('size-1.5 rounded-full', DOT[size.level])}
        aria-hidden="true"
      />
      {formatTokens(size.tokens)}
      {size.images > 0 && (
        <span className="hidden sm:inline">· {size.images} img</span>
      )}
    </span>
  )
}
