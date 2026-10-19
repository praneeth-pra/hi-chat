import { useMemo } from 'react'
import { ThreadMessage } from '@janhq/core'
import { useAssistant } from '@/hooks/useAssistant'
import { withAnswerDetail } from '@/lib/answerDetail'
import { withDocuments } from '@/lib/assistantDocuments'
import { contextSize, formatBytes, formatTokens } from '@/lib/contextSize'
import { chatDelay } from '@/lib/replySpeed'
import { cn } from '@/lib/utils'

const DOT = {
  light: 'bg-green-500',
  medium: 'bg-amber-500',
  heavy: 'bg-red-500',
}

const secs = (s: number) => `${s.toFixed(1)} s`

/**
 * Next to the model: how much the next question sends, and whether that is
 * actually slowing this chat's answers down. The colour comes from measured
 * timings (this chat's latest answers against a fresh chat's), never from
 * the size alone.
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
  const delay = useMemo(() => chatDelay(messages), [messages])
  if (!messages.length && !draft.trim() && !draftImages.length) return null
  const level = delay?.level ?? 'light'
  const images = size.images
    ? ` and ${size.images} image${size.images > 1 ? 's' : ''} (${formatBytes(size.imageBytes)})`
    : ''
  const speed = !delay
    ? 'No slowdown measured yet.'
    : level === 'light'
      ? `Answers here start as fast as in a new chat (${secs(delay.recentS)}).`
      : `Answers here start ${secs(delay.delayS)} later than in a new chat (${secs(delay.recentS)} against ${secs(delay.baselineS)}).${level === 'heavy' ? ' A new chat (fn + N) starts fast again.' : ''}`
  const label = `Each question sends about ${formatTokens(size.tokens)} tokens of text${images}. ${speed}`
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
      {level === 'light' || !delay
        ? formatTokens(size.tokens)
        : `+${secs(delay.delayS)}`}
      {size.images > 0 && (
        <span className="hidden sm:inline">· {size.images} img</span>
      )}
    </span>
  )
}
