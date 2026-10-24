import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  createFileRoute,
  useParams,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import cloneDeep from 'lodash.clonedeep'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'

import HeaderPage from '@/containers/HeaderPage'
import { ThreadActions } from '@/containers/ThreadActions'
import { useThreads } from '@/hooks/useThreads'
import ChatInput from '@/containers/ChatInput'
import { useShallow } from 'zustand/react/shallow'
import { ThreadContent } from '@/containers/ThreadContent'
import { useStreamingItem } from '@/containers/StreamingContent'
import { AccuracyProgress } from '@/containers/AccuracyProgress'

import { useMessages } from '@/hooks/useMessages'
import { useServiceHub } from '@/hooks/useServiceHub'
import DropdownAssistant from '@/containers/DropdownAssistant'
import { useAssistant } from '@/hooks/useAssistant'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { ContentType, ThreadMessage } from '@janhq/core'
import { useSmallScreen, useMobileScreen } from '@/hooks/useMediaQuery'
import { useTools } from '@/hooks/useTools'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import ScrollToBottom from '@/containers/ScrollToBottom'
import { PromptProgress } from '@/components/PromptProgress'
import { ThreadPadding } from '@/containers/ThreadPadding'
import { ThreadScrollProvider } from '@/containers/ThreadScrollProvider'
import { TEMPORARY_CHAT_ID, TEMPORARY_CHAT_QUERY_ID } from '@/constants/chat'
import { IconInfoCircle } from '@tabler/icons-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { syncThreadFromMessages } from '@/hooks/useThreadHygiene'

const CONVERSATION_NOT_FOUND_EVENT = 'conversation-not-found'

const TemporaryChatIndicator = ({ t }: { t: (key: string) => string }) => {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-main-view-fg/5 text-main-view-fg/70 text-sm">
      <span>{t('common:temporaryChat')}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative z-20">
            <IconInfoCircle
              size={14}
              className="text-main-view-fg/50 hover:text-main-view-fg/70 transition-colors cursor-pointer"
            />
          </div>
        </TooltipTrigger>
        <TooltipContent className="z-[9999]">
          <p>{t('common:temporaryChatTooltip')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
  beforeLoad: ({ params }) => {
    // Check if this is the temporary chat being accessed directly
    if (params.threadId === TEMPORARY_CHAT_ID) {
      // Check if we have the navigation flag in sessionStorage
      const hasNavigationFlag = sessionStorage.getItem('temp-chat-nav')

      if (!hasNavigationFlag) {
        // Direct access - redirect to home with query parameter
        throw redirect({
          to: '/',
          search: { [TEMPORARY_CHAT_QUERY_ID]: true },
          replace: true,
        })
      }

      // Clear the flag immediately after checking
      sessionStorage.removeItem('temp-chat-nav')
    }
  },
  component: ThreadDetail,
})

function ThreadDetail() {
  const serviceHub = useServiceHub()
  const { threadId } = useParams({ from: Route.id })
  const navigate = useNavigate()
  const { t } = useTranslation()
  const setCurrentThreadId = useThreads((state) => state.setCurrentThreadId)
  const setCurrentAssistant = useAssistant((state) => state.setCurrentAssistant)
  const assistants = useAssistant((state) => state.assistants)
  const setMessages = useMessages((state) => state.setMessages)

  const chatWidth = useInterfaceSettings((state) => state.chatWidth)
  const isSmallScreen = useSmallScreen()
  const isMobile = useMobileScreen()
  useTools()

  const streaming = useStreamingItem(threadId)
  const { messages } = useMessages(
    useShallow((state) => ({
      messages: state.messages[threadId],
    }))
  )
  const list = messages ?? []

  // Subscribe directly to the thread data to ensure updates when model changes
  const thread = useThreads(useShallow((state) => state.threads[threadId]))
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Listen for conversation not found events
  useEffect(() => {
    const handleConversationNotFound = (event: CustomEvent) => {
      const { threadId: notFoundThreadId } = event.detail
      if (notFoundThreadId === threadId) {
        // Skip error handling for temporary chat - it's expected to not exist on server
        if (threadId === TEMPORARY_CHAT_ID) {
          return
        }

        toast.error(t('common:conversationNotAvailable'), {
          description: t('common:conversationNotAvailableDescription'),
        })
        navigate({ to: '/', replace: true })
      }
    }

    window.addEventListener(
      CONVERSATION_NOT_FOUND_EVENT,
      handleConversationNotFound as EventListener
    )
    return () => {
      window.removeEventListener(
        CONVERSATION_NOT_FOUND_EVENT,
        handleConversationNotFound as EventListener
      )
    }
  }, [threadId, navigate, t])

  useEffect(() => {
    setCurrentThreadId(threadId)
    const assistant = assistants.find(
      (assistant) => assistant.id === thread?.assistants?.[0]?.id
    )
    if (assistant) setCurrentAssistant(assistant)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, assistants])

  useEffect(() => {
    serviceHub
      .messages()
      .fetchMessages(threadId)
      .then((fetchedMessages) => {
        if (fetchedMessages) {
          const currentLocalMessages = useMessages
            .getState()
            .getMessages(threadId)

          if (
            PlatformFeatures[PlatformFeature.FIRST_MESSAGE_PERSISTED_THREAD] &&
            fetchedMessages.length === 0 &&
            currentLocalMessages &&
            currentLocalMessages.length > 0
          ) {
            return
          }

          // Update the messages in the store
          if (currentLocalMessages && currentLocalMessages.length > 0) {
            const fetchedIds = new Set(fetchedMessages.map((m) => m.id))
            const localOnlyMessages = currentLocalMessages.filter(
              (m) => !fetchedIds.has(m.id)
            )

            if (localOnlyMessages.length > 0) {
              const mergedMessages = [
                ...fetchedMessages,
                ...localOnlyMessages,
              ].sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
              setMessages(threadId, mergedMessages)
              syncThreadFromMessages(threadId, mergedMessages)
              return
            }
          }

          setMessages(threadId, fetchedMessages)
          syncThreadFromMessages(threadId, fetchedMessages)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, serviceHub])

  useEffect(() => {
    return () => {
      // Clear the current thread ID when the component unmounts
      setCurrentThreadId(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateMessage = useCallback(
    (item: ThreadMessage, message: string, imageUrls?: string[]) => {
      const currentMessages = useMessages.getState().getMessages(threadId)
      const newMessages: ThreadMessage[] = currentMessages.map((m) => {
        if (m.id === item.id) {
          const msg: ThreadMessage = cloneDeep(m)
          const newContent = [
            {
              type: ContentType.Text,
              text: {
                value: message,
                annotations: m.content[0].text?.annotations ?? [],
              },
            },
          ]
          // Add image content if imageUrls are provided
          if (imageUrls && imageUrls.length > 0) {
            imageUrls.forEach((url) => {
              newContent.push({
                type: 'image_url' as ContentType,
                image_url: {
                  url: url,
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any)
            })
          }
          msg.content = newContent
          return msg
        }
        return m
      })
      setMessages(threadId, newMessages)
    },
    [threadId, setMessages]
  )

  const threadModel = useMemo(() => thread?.model, [thread])

  if (!messages || !threadModel) return null

  return (
    <ThreadScrollProvider
      threadId={threadId}
      scrollContainerRef={scrollContainerRef}
    >
      <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))] md:h-[calc(100dvh-18px)]">
        <HeaderPage>
          <div className="flex items-center justify-between w-full gap-2">
            {/* The title takes the room the buttons leave, ending in "…"
                rather than running under them */}
            <div className="flex min-w-0 flex-1">
              {PlatformFeatures[PlatformFeature.ASSISTANTS] && (
                <DropdownAssistant />
              )}
            </div>
            <div className="flex shrink-0 justify-center">
              {threadId === TEMPORARY_CHAT_ID && (
                <TemporaryChatIndicator t={t} />
              )}
            </div>
            {thread && <ThreadActions key={thread.id} thread={thread} />}
          </div>
        </HeaderPage>
        <div className="flex flex-col h-[calc(100%-48px)]">
          <div
            ref={scrollContainerRef}
            data-thread-scroller
            className={cn(
              'flex flex-col h-full w-full overflow-auto pt-4 pb-3',
              // Mobile-first responsive padding
              isMobile ? 'px-3' : 'px-4'
            )}
          >
            <div
              className={cn(
                'mx-auto flex max-w-full flex-col grow',
                // Mobile-first width constraints
                // Mobile and small screens always use full width, otherwise compact chat uses constrained width
                isMobile || isSmallScreen || chatWidth !== 'compact'
                  ? 'w-full'
                  : 'w-full max-w-3xl'
              )}
            >
              {[
                ...list.map((item, index) => {
                  // Only pass isLastMessage to the last message in the array
                  const isLastMessage = index === list.length - 1
                  // Older off-screen messages skip layout and paint until
                  // scrolled to, so long chats open and stream lightly. The
                  // last few stay laid out, so a new question's jump to the
                  // top lands where it was aimed.
                  return (
                    <div
                      key={item.id}
                      data-test-id={`message-${item.role}-${item.id}`}
                      data-message-author-role={item.role}
                      className={cn(
                        'mb-4',
                        index < list.length - 4 &&
                          '[content-visibility:auto] [contain-intrinsic-size:auto_480px]'
                      )}
                    >
                      <ThreadContent
                        {...item}
                        isLastMessage={isLastMessage}
                        showAssistant={
                          item.role === 'assistant' &&
                          (index === 0 ||
                            list[index - 1]?.role !== 'assistant' ||
                            !(
                              list[index - 1]?.metadata &&
                              'tool_calls' in (list[index - 1].metadata ?? {})
                            ))
                        }
                        index={index}
                        updateMessage={updateMessage}
                      />
                    </div>
                  )
                }),
                // In the same list as the messages: React keeps an element
                // only among siblings of one list
                streaming?.kind === 'answer' && (
                  // Same place, element and key (the answer's id) as the
                  // saved message that replaces it, so finishing keeps it
                  <div
                    key={streaming.id}
                    data-test-id="thread-content-text"
                    data-message-author-role="assistant"
                    className="mb-4"
                  >
                    <ThreadContent {...streaming.props} />
                  </div>
                ),
              ]}
              <PromptProgress />
              {streaming?.kind === 'accuracy' && (
                <AccuracyProgress key={threadId} phase={streaming.phase} />
              )}
              {/* Persistent padding element for ChatGPT-style message positioning */}
              <ThreadPadding />
            </div>
          </div>
          <div
            className={cn(
              // Tight under the message box: the room goes to the answer
              'mx-auto pt-1 pb-1 shrink-0 relative',
              // Responsive padding and width
              isMobile ? 'px-3' : 'px-2',
              // Width: mobile/small screens or non-compact always full, compact desktop uses constrained
              isMobile || isSmallScreen || chatWidth !== 'compact'
                ? 'w-full'
                : 'w-full max-w-3xl'
            )}
          >
            <ScrollToBottom threadId={threadId} />
            <ChatInput model={threadModel} />
          </div>
        </div>
      </div>
    </ThreadScrollProvider>
  )
}
