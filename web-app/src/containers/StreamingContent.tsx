import { useAppState } from '@/hooks/useAppState'
import { ThreadContent } from './ThreadContent'
import { memo, useMemo, type ComponentProps } from 'react'
import { useMessages } from '@/hooks/useMessages'
import { MessageStatus } from '@janhq/core'
import { AccuracyProgress } from './AccuracyProgress'

const EMPTY_MESSAGES: import('@janhq/core').ThreadMessage[] = []

type Props = {
  threadId: string
}

// Helper to extract <think>...</think> segment
function extractReasoningSegment(text: string) {
  if (!text) return ''
  const match = text.match(/<think>([\s\S]*?)<\/think>/)
  if (match) return match[0].trim()
  // If only opening <think> and no closing, take everything after <think>
  const openIdx = text.indexOf('<think>')
  if (openIdx !== -1) return text.slice(openIdx).trim()
  return ''
}

export type StreamingItem =
  | { kind: 'accuracy'; phase: Parameters<typeof AccuracyProgress>[0]['phase'] }
  | { kind: 'answer'; id: string; props: ComponentProps<typeof ThreadContent> }

/**
 * What to show for the answer streaming into this thread, if any. The
 * thread draws the answer in its list of messages, keyed by its id, which
 * the saved message keeps: when the answer finishes it stays on screen as
 * it is instead of being drawn again.
 */
export function useStreamingItem(threadId: string): StreamingItem | null {
  const streamingContent = useAppState((state) => state.streamingContent)
  const accuracyStatus = useAppState((state) => state.accuracyStatus)
  const messages = useMessages(
    (state) => state.messages[threadId] ?? EMPTY_MESSAGES
  )

  const streamingReasoning = useMemo(() => {
    const text =
      streamingContent?.content?.find((e) => e.type === 'text')?.text?.value ||
      ''
    return extractReasoningSegment(text)
  }, [streamingContent])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streamingTools: any = useMemo(() => {
    const calls = streamingContent?.metadata?.tool_calls
    return calls
  }, [streamingContent])

  const lastAssistant = useMemo(() => {
    return [...messages].reverse().find((m) => m.role === 'assistant')
  }, [messages])
  const lastAssistantReasoning = useMemo(() => {
    if (!lastAssistant) return ''
    const text =
      lastAssistant.content?.find((e) => e.type === 'text')?.text?.value || ''
    return extractReasoningSegment(text)
  }, [lastAssistant])

  if (accuracyStatus?.threadId === threadId) {
    return { kind: 'accuracy', phase: accuracyStatus.phase }
  }

  if (!streamingContent || streamingContent.thread_id !== threadId) {
    return null
  }

  // Already saved (the same answer, by id): the saved message shows it
  if (messages.some((m) => m.id === streamingContent.id)) return null

  // Avoid duplicate reasoning segments after tool calls
  if (streamingReasoning && streamingReasoning === lastAssistantReasoning) {
    return null
  }

  // Don't show streaming content if there's already a stopped message
  if (
    lastAssistant?.status === MessageStatus.Stopped &&
    lastAssistant.id === streamingContent.id
  ) {
    return null
  }

  // The streaming content is always the last message
  return {
    kind: 'answer',
    id: streamingContent.id,
    props: {
      streamTools: {
        tool_calls: {
          function: {
            name: streamingTools?.[0]?.function?.name as string,
            arguments: streamingTools?.[0]?.function?.arguments as string,
          },
        },
      },
      ...streamingContent,
      isLastMessage: true,
      streamingThread: streamingContent.thread_id,
      showAssistant:
        messages.length > 0
          ? messages[messages.length - 1].role !== 'assistant'
          : true,
    } as ComponentProps<typeof ThreadContent>,
  }
}

/** The streaming answer on its own (the thread page draws it in its list). */
export const StreamingContent = memo(({ threadId }: Props) => {
  const item = useStreamingItem(threadId)
  if (!item) return null
  if (item.kind === 'accuracy')
    return <AccuracyProgress key={threadId} phase={item.phase} />
  return <ThreadContent {...item.props} />
})
