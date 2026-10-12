import { raceAutoAnswers } from '@/lib/autoRace'
import {
  getWebEvidence,
  groundAccuracyMessages,
  buildAccuracyQuery,
  verifyAccuracyCompletion,
  isPersonalQuestion,
  personalEvidence,
  accuracyLogLine,
  type WebEvidence,
  type AccuracyReview,
} from '@/lib/accuracyReview'
import { useCallback, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { usePrompt } from './usePrompt'
import { useModelProvider } from './useModelProvider'
import { useThreads } from './useThreads'
import { useAppState, type PromptProgress } from './useAppState'
import { useMessages } from './useMessages'
import { useRouter } from '@tanstack/react-router'
import { defaultModel } from '@/lib/models'
import { route } from '@/constants/routes'
import {
  emptyThreadContent,
  extractToolCall,
  isCompletionResponse,
  newAssistantThreadContent,
  newUserThreadContent,
  postMessageProcessing,
  sendCompletion,
  captureProactiveScreenshots,
} from '@/lib/completion'
import { CompletionMessagesBuilder } from '@/lib/messages'
import { processAttachmentsForSend } from '@/lib/attachmentProcessing'
import { renderInstructions } from '@/lib/instructionTemplate'
import { withCodingRule } from '@/lib/codingAnswer'
import { withAnswerDetail, withMediumLength } from '@/lib/answerDetail'
import { createStreamFlushScheduler } from '@/lib/streamFlushScheduler'
import { withDocuments, withoutDocuments } from '@/lib/assistantDocuments'
import {
  ChatCompletionMessageToolCall,
  CompletionUsage,
} from 'openai/resources'
import {
  MessageStatus,
  ContentType,
  ThreadMessage,
  type chatCompletionChunk,
} from '@janhq/core'
import { useAttachments } from '@/hooks/useAttachments'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useToolApproval } from '@/hooks/useToolApproval'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { OUT_OF_CONTEXT_SIZE } from '@/utils/error'
import { useContextSizeApproval } from './useModelContextApproval'
import { useModelLoad } from './useModelLoad'
import {
  ReasoningProcessor,
  extractReasoningFromMessage,
} from '@/utils/reasoning'
import { useAssistant } from './useAssistant'
import { useShallow } from 'zustand/shallow'
import { TEMPORARY_CHAT_QUERY_ID, TEMPORARY_CHAT_ID } from '@/constants/chat'
import { Attachment } from '@/types/attachment'
import { MCPTool } from '@/types/completion'
import { useMCPServers } from '@/hooks/useMCPServers'
import { titleFromMessage } from '@/lib/chatList'
import { autoChain, useChatAuto } from '@/lib/chatModels'
import { hasImages } from '@/lib/visionModels'
import { streamClaude } from '@/lib/claudeChat'
import { claudeAccuracyAnswer } from '@/lib/accuracyClaude'
import { anthropicConfig } from '@/lib/anthropicProvider'
import { reportSpeech } from '@/lib/speechServices'
import { useAttachmentIngestionPrompt } from './useAttachmentIngestionPrompt'
import {
  describeTiming,
  speedLogLine,
  pageHidden,
  type StreamTiming,
} from '@/lib/replyTiming'

// Helper to create thread content with consistent structure
const createThreadContent = (
  threadId: string,
  text: string,
  toolCalls: ChatCompletionMessageToolCall[],
  messageId?: string
) => {
  const content = newAssistantThreadContent(threadId, text, {
    tool_calls: toolCalls.map((e) => ({
      ...e,
      state: 'pending',
    })),
  })
  // If continuing from a message, preserve the message ID
  if (messageId) {
    return { ...content, id: messageId }
  }
  return content
}

const ATTACHMENT_AUTO_INLINE_FALLBACK_BYTES = 512 * 1024

// Helper to finalize and save a message
const finalizeMessage = (
  finalContent: ThreadMessage,
  addMessage: (message: ThreadMessage) => void,
  updateStreamingContent: (content: ThreadMessage | undefined) => void,
  updatePromptProgress: (progress: PromptProgress | undefined) => void,
  updateThreadTimestamp: (threadId: string) => void,
  updateMessage?: (message: ThreadMessage) => void,
  continueFromMessageId?: string
) => {
  // If continuing from a message, update it; otherwise add new message
  if (continueFromMessageId && updateMessage) {
    updateMessage({ ...finalContent, id: continueFromMessageId })
  } else {
    addMessage(finalContent)
  }
  updateStreamingContent(emptyThreadContent)
  updatePromptProgress(undefined)
  updateThreadTimestamp(finalContent.thread_id)
}

// Helper to process streaming completion
const processStreamingCompletion = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  completion: AsyncIterable<any>,
  abortController: AbortController,
  activeThread: Thread,
  accumulatedTextRef: { value: string },
  toolCalls: ChatCompletionMessageToolCall[],
  currentCall: ChatCompletionMessageToolCall | null,
  updateStreamingContent: (content: ThreadMessage | undefined) => void,
  updateTokenSpeed: (message: ThreadMessage, increment?: number) => void,
  setTokenSpeed: (
    message: ThreadMessage,
    tokensPerSecond: number,
    totalTokens: number
  ) => void,
  updatePromptProgress: (progress: PromptProgress | undefined) => void,
  timeToFirstToken: number,
  tokenUsageRef: { current: CompletionUsage | undefined },
  continueFromMessageId?: string,
  updateMessage?: (message: ThreadMessage) => void,
  continueFromMessage?: ThreadMessage,
  timing?: StreamTiming
) => {
  let firstAnswerFlushed = false
  let pendingDeltaCount = 0
  const reasoningProcessor = new ReasoningProcessor()

  const flushStreamingContent = () => {
    const currentContent = createThreadContent(
      activeThread.id,
      accumulatedTextRef.value,
      toolCalls,
      continueFromMessageId
    )

    // When continuing, update the message directly instead of using streamingContent
    if (continueFromMessageId && updateMessage && continueFromMessage) {
      updateMessage({
        ...continueFromMessage, // Preserve original message metadata
        content: currentContent.content, // Update content
        status: MessageStatus.Stopped, // Keep as Stopped while streaming
      })
    } else {
      updateStreamingContent(currentContent)
    }

    if (tokenUsageRef.current) {
      setTokenSpeed(
        currentContent,
        tokenUsageRef.current.completion_tokens /
          Math.max((Date.now() - timeToFirstToken) / 1000, 1),
        tokenUsageRef.current.completion_tokens
      )
    } else if (pendingDeltaCount > 0) {
      updateTokenSpeed(currentContent, pendingDeltaCount)
    }
    pendingDeltaCount = 0
  }

  const scheduler = createStreamFlushScheduler(
    flushStreamingContent,
    abortController.signal
  )
  const scheduleFlush = (immediate = false) => scheduler.schedule(immediate)

  try {
    for await (const part of completion) {
      // Check if aborted before processing each part
      if (abortController.signal.aborted) {
        break
      }
      if (timing) {
        if (timing.firstChunkAt === undefined) {
          timing.firstChunkAt = Date.now()
          if (typeof part.created === 'number')
            timing.providerCreated = part.created
          timing.hiddenAtFirstChunk = pageHidden()
        }
        // Groq reports its own queue, prompt and generation times on the last chunk
        if (part.x_groq?.usage) timing.usage = part.x_groq.usage
        else if (part.usage) timing.usage ??= part.usage
      }

      // Handle prompt progress if available
      if ('prompt_progress' in part && part.prompt_progress) {
        // Force immediate state update to ensure we see intermediate values
        flushSync(() => {
          updatePromptProgress(part.prompt_progress)
        })
      }

      // Error message
      if (!part.choices) {
        throw new Error(
          'message' in part
            ? (part.message as string)
            : (JSON.stringify(part) ?? '')
        )
      }

      if (part.choices[0]?.delta?.tool_calls) {
        extractToolCall(part, currentCall, toolCalls)
        // Schedule a flush to reflect tool update
        scheduleFlush()
      }
      const deltaReasoning = reasoningProcessor.processReasoningChunk(part)
      if (deltaReasoning) {
        accumulatedTextRef.value += deltaReasoning
        pendingDeltaCount += 1
        // Schedule flush for reasoning updates
        scheduleFlush()
      }
      const deltaContent = part.choices[0]?.delta?.content || ''
      if (deltaContent) {
        const useful = !!deltaContent.trim()
        if (timing && useful) timing.firstAnswerAt ??= Date.now()
        accumulatedTextRef.value += deltaContent
        pendingDeltaCount += 1
        // Show the first useful text immediately; batch later tokens.
        scheduleFlush(useful && !firstAnswerFlushed)
        if (useful) firstAnswerFlushed = true
      }
    }
  } finally {
    scheduler.dispose()

    // Finalize reasoning (close any open think tags)
    accumulatedTextRef.value += reasoningProcessor.finalize()
  }
}

export const useChat = () => {
  const [
    updateTokenSpeed,
    resetTokenSpeed,
    updateStreamingContent,
    updateLoadingModel,
    setAbortController,
    setTokenSpeed,
  ] = useAppState(
    useShallow((state) => [
      state.updateTokenSpeed,
      state.resetTokenSpeed,
      state.updateStreamingContent,
      state.updateLoadingModel,
      state.setAbortController,
      state.setTokenSpeed,
    ])
  )
  const updatePromptProgress = useAppState(
    (state) => state.updatePromptProgress
  )

  const updateProvider = useModelProvider((state) => state.updateProvider)
  const serviceHub = useServiceHub()

  const showApprovalModal = useToolApproval((state) => state.showApprovalModal)
  const allowAllMCPPermissions = useToolApproval(
    (state) => state.allowAllMCPPermissions
  )
  const showIncreaseContextSizeModal = useContextSizeApproval(
    (state) => state.showApprovalModal
  )
  const getDisabledToolsForThread = useToolAvailable(
    (state) => state.getDisabledToolsForThread
  )
  const mcpSettings = useMCPServers((state) => state.settings)

  const getProviderByName = useModelProvider((state) => state.getProviderByName)

  const [createThread, retrieveThread, updateThreadTimestamp] = useThreads(
    useShallow((state) => [
      state.createThread,
      state.getCurrentThread,
      state.updateThreadTimestamp,
    ])
  )

  const getMessages = useMessages((state) => state.getMessages)
  const addMessage = useMessages((state) => state.addMessage)
  const updateMessage = useMessages((state) => state.updateMessage)
  const setMessages = useMessages((state) => state.setMessages)
  const setModelLoadError = useModelLoad((state) => state.setModelLoadError)
  const router = useRouter()
  const setActiveModels = useAppState((state) => state.setActiveModels)

  const getCurrentThread = useCallback(
    async (projectId?: string, firstMessage?: string) => {
      let currentThread = retrieveThread()

      // Check if we're in temporary chat mode
      const isTemporaryMode = window.location.search.includes(
        `${TEMPORARY_CHAT_QUERY_ID}=true`
      )

      // Clear messages for existing temporary thread on reload to ensure fresh start
      if (isTemporaryMode && currentThread?.id === TEMPORARY_CHAT_ID) {
        setMessages(TEMPORARY_CHAT_ID, [])
      }

      if (!currentThread) {
        const currentAssistant = useAssistant.getState().currentAssistant
        const assistants = useAssistant.getState().assistants
        const selectedModel = useModelProvider.getState().selectedModel
        const selectedProvider = useModelProvider.getState().selectedProvider

        // Get project metadata if projectId is provided
        let projectMetadata:
          | { id: string; name: string; updated_at: number }
          | undefined
        if (projectId) {
          const project = await serviceHub.projects().getProjectById(projectId)
          if (project) {
            projectMetadata = {
              id: project.id,
              name: project.name,
              updated_at: project.updated_at,
            }
          }
        }

        currentThread = await createThread(
          {
            id: selectedModel?.id ?? defaultModel(selectedProvider),
            provider: selectedProvider,
          },
          isTemporaryMode ? 'Temporary Chat' : titleFromMessage(firstMessage),
          withoutDocuments(
            assistants.find((a) => a.id === currentAssistant?.id) ||
              assistants[0]
          ),
          projectMetadata,
          isTemporaryMode // pass temporary flag
        )

        // Clear messages for temporary chat to ensure fresh start on reload
        if (isTemporaryMode && currentThread?.id === TEMPORARY_CHAT_ID) {
          setMessages(TEMPORARY_CHAT_ID, [])
        }

        // Set flag for temporary chat navigation
        if (currentThread.id === TEMPORARY_CHAT_ID) {
          sessionStorage.setItem('temp-chat-nav', 'true')
        }

        router.navigate({
          to: route.threadsDetail,
          params: { threadId: currentThread.id },
        })
      }
      return currentThread
    },
    [createThread, retrieveThread, router, setMessages, serviceHub]
  )

  const restartModel = useCallback(
    async (provider: ProviderObject, modelId: string) => {
      await serviceHub.models().stopAllModels()
      updateLoadingModel(true)
      await serviceHub
        .models()
        .startModel(provider, modelId)
        .catch(console.error)
      // Refresh active models after starting
      updateLoadingModel(false)
      serviceHub
        .models()
        .getActiveModels()
        .then((models) => setActiveModels(models || []))
    },
    [updateLoadingModel, serviceHub, setActiveModels]
  )

  const ensureModelLoaded = useCallback(
    async (provider?: ProviderObject, modelId?: string | null) => {
      if (!provider || !modelId) return false
      try {
        const active = await serviceHub.models().getActiveModels()
        if (Array.isArray(active) && active.includes(modelId)) {
          setActiveModels(active)
          return true
        }
        updateLoadingModel(true)
        await serviceHub.models().startModel(provider, modelId)
        const refreshed = await serviceHub.models().getActiveModels()
        setActiveModels(refreshed || [])
        return refreshed?.includes(modelId) ?? false
      } catch (err) {
        console.warn('Failed to start model before attachment validation', err)
        return false
      } finally {
        updateLoadingModel(false)
      }
    },
    [serviceHub, setActiveModels, updateLoadingModel]
  )

  const increaseModelContextSize = useCallback(
    async (modelId: string, provider: ProviderObject) => {
      /**
       * Should increase the context size of the model by 2x
       * If the context size is not set or too low, it defaults to 8192.
       */
      const model = provider.models.find((m) => m.id === modelId)
      if (!model) return undefined
      const ctxSize = Math.max(
        model.settings?.ctx_len?.controller_props.value
          ? typeof model.settings.ctx_len.controller_props.value === 'string'
            ? parseInt(model.settings.ctx_len.controller_props.value as string)
            : (model.settings.ctx_len.controller_props.value as number)
          : 16384,
        16384
      )
      const updatedModel = {
        ...model,
        settings: {
          ...model.settings,
          ctx_len: {
            ...(model.settings?.ctx_len != null ? model.settings?.ctx_len : {}),
            controller_props: {
              ...(model.settings?.ctx_len?.controller_props ?? {}),
              value: ctxSize * 2,
            },
          },
        },
      }

      // Find the model index in the provider's models array
      const modelIndex = provider.models.findIndex((m) => m.id === model.id)

      if (modelIndex !== -1) {
        // Create a copy of the provider's models array
        const updatedModels = [...provider.models]

        // Update the specific model in the array
        updatedModels[modelIndex] = updatedModel as Model

        // Update the provider with the new models array
        updateProvider(provider.provider, {
          models: updatedModels,
        })
      }
      const updatedProvider = getProviderByName(provider.provider)
      if (updatedProvider) await restartModel(updatedProvider, model.id)

      return updatedProvider
    },
    [getProviderByName, restartModel, updateProvider]
  )
  const toggleOnContextShifting = useCallback(
    async (modelId: string, provider: ProviderObject) => {
      const providerName = provider.provider
      const newSettings = [...provider.settings]
      const settingKey = 'ctx_shift'
      // Handle different value types by forcing the type
      // Use type assertion to bypass type checking
      const settingIndex = provider.settings.findIndex(
        (s) => s.key === settingKey
      )
      ;(
        newSettings[settingIndex].controller_props as {
          value: string | boolean | number
        }
      ).value = true

      // Create update object with updated settings
      const updateObj: Partial<ModelProvider> = {
        settings: newSettings,
      }

      await serviceHub
        .providers()
        .updateSettings(providerName, updateObj.settings ?? [])
      updateProvider(providerName, {
        ...provider,
        ...updateObj,
      })
      const updatedProvider = getProviderByName(providerName)
      if (updatedProvider) await restartModel(updatedProvider, modelId)
      return updatedProvider
    },
    [updateProvider, getProviderByName, restartModel, serviceHub]
  )

  const sendMessage = useCallback(
    async (
      message: string,
      troubleshooting = true,
      attachments?: Attachment[],
      projectId?: string,
      updateAttachmentProcessing?: (
        fileName: string,
        status: 'processing' | 'done' | 'error' | 'clear_all',
        updatedAttachment?: Partial<Attachment>
      ) => void,
      continueFromMessageId?: string
    ) => {
      const activeThread = await getCurrentThread(projectId, message)
      const selectedProvider = useModelProvider.getState().selectedProvider
      let selectedModel = useModelProvider.getState().selectedModel
      let activeProvider = getProviderByName(selectedProvider)

      resetTokenSpeed()
      if (!activeThread || !activeProvider) return

      const allAttachments = attachments ?? []
      const parsePreference = useAttachments.getState().parseMode
      const autoInlineContextRatio =
        useAttachments.getState().autoInlineContextRatio
      const modelReady = await ensureModelLoaded(
        activeProvider,
        selectedModel?.id
      )

      const modelContextLength = (() => {
        const ctx = selectedModel?.settings?.ctx_len?.controller_props?.value
        if (typeof ctx === 'number') return ctx
        if (typeof ctx === 'string') {
          const parsed = parseInt(ctx, 10)
          return Number.isFinite(parsed) ? parsed : undefined
        }
        return undefined
      })()

      const rawContextThreshold =
        typeof modelContextLength === 'number' && modelContextLength > 0
          ? Math.floor(
              modelContextLength *
                (typeof autoInlineContextRatio === 'number'
                  ? autoInlineContextRatio
                  : 0.75)
            )
          : undefined

      const contextThreshold =
        typeof rawContextThreshold === 'number' &&
        Number.isFinite(rawContextThreshold) &&
        rawContextThreshold > 0
          ? rawContextThreshold
          : undefined

      const hasContextEstimate =
        modelReady &&
        typeof contextThreshold === 'number' &&
        Number.isFinite(contextThreshold) &&
        contextThreshold > 0
      const docsNeedingPrompt = allAttachments.filter((doc) => {
        if (doc.type !== 'document') return false
        // Skip already processed/ingested documents to avoid repeated prompts
        if (doc.processed || doc.injectionMode) return false
        const preference = doc.parseMode ?? parsePreference
        return (
          preference === 'prompt' ||
          (preference === 'auto' && !hasContextEstimate)
        )
      })

      // Map to store individual choices for each document
      const docChoices = new Map<string, 'inline' | 'embeddings'>()

      if (docsNeedingPrompt.length > 0) {
        // Ask for each file individually
        for (let i = 0; i < docsNeedingPrompt.length; i++) {
          const doc = docsNeedingPrompt[i]
          const choice = await useAttachmentIngestionPrompt
            .getState()
            .showPrompt(
              doc,
              ATTACHMENT_AUTO_INLINE_FALLBACK_BYTES,
              i,
              docsNeedingPrompt.length
            )

          if (!choice) return

          // Store the choice for this specific document
          if (doc.path) {
            docChoices.set(doc.path, choice)
          }
        }
      }

      const estimateTokens = async (
        text: string
      ): Promise<number | undefined> => {
        try {
          if (!selectedModel?.id || !modelReady) return undefined
          const tokenCount = await serviceHub
            .models()
            .getTokensCount(selectedModel.id, [
              {
                id: 'inline-attachment',
                object: 'thread.message',
                thread_id: activeThread.id,
                role: 'user',
                content: [
                  {
                    type: ContentType.Text,
                    text: { value: text, annotations: [] },
                  },
                ],
                status: MessageStatus.Ready,
                created_at: Date.now(),
                completed_at: Date.now(),
              } as ThreadMessage,
            ])
          if (
            typeof tokenCount !== 'number' ||
            !Number.isFinite(tokenCount) ||
            tokenCount <= 0
          ) {
            return undefined
          }
          return tokenCount
        } catch (e) {
          console.debug('Failed to estimate tokens for attachment content', e)
          return undefined
        }
      }

      let processedAttachments: Attachment[] = []
      let hasEmbeddedDocuments = false
      try {
        const result = await processAttachmentsForSend({
          attachments: allAttachments,
          threadId: activeThread.id,
          serviceHub,
          selectedProvider,
          contextThreshold,
          estimateTokens,
          parsePreference,
          perFileChoices: docChoices.size > 0 ? docChoices : undefined,
          updateAttachmentProcessing,
        })
        processedAttachments = result.processedAttachments
        hasEmbeddedDocuments = result.hasEmbeddedDocuments
      } catch {
        return
      }

      if (hasEmbeddedDocuments) {
        useThreads.getState().updateThread(activeThread.id, {
          metadata: {
            ...useThreads.getState().threads[activeThread.id]?.metadata,
            hasDocuments: true,
          },
        })
      }

      // All attachments prepared successfully

      const messages = getMessages(activeThread.id)
      const abortController = new AbortController()
      let accuracyRequested = false
      setAbortController(activeThread.id, abortController)
      updateStreamingContent(emptyThreadContent)
      updatePromptProgress(undefined)

      // Find the message to continue from if provided
      const continueFromMessage = continueFromMessageId
        ? messages.find((m) => m.id === continueFromMessageId)
        : undefined

      // Do not add new message on retry or when continuing
      // All attachments (images + docs) ingested successfully.
      // Build the user content once; use it for both the outbound request
      // and persisting to the store so both are identical.
      updateAttachmentProcessing?.('__CLEAR_ALL__', 'clear_all')
      const userContent = newUserThreadContent(
        activeThread.id,
        message,
        processedAttachments
      )
      if (troubleshooting && !continueFromMessageId) {
        addMessage(userContent)
      }
      updateThreadTimestamp(activeThread.id)
      usePrompt.getState().setPrompt('')
      selectedModel = useModelProvider.getState().selectedModel

      // If continuing, start with the previous content
      const accumulatedTextRef = {
        value: continueFromMessage?.content?.[0]?.text?.value || '',
      }
      let currentAssistant: Assistant | undefined | null

      try {
        if (selectedModel?.id && !modelReady) {
          updateLoadingModel(true)
          await serviceHub.models().startModel(activeProvider, selectedModel.id)
          updateLoadingModel(false)
          // Refresh active models after starting
          serviceHub
            .models()
            .getActiveModels()
            .then((models) => setActiveModels(models || []))
        } else if (selectedModel?.id) {
          serviceHub
            .models()
            .getActiveModels()
            .then((models) => setActiveModels(models || []))
        }
        currentAssistant = useAssistant.getState().currentAssistant

        // Filter out the stopped message from context if continuing
        const contextMessages = continueFromMessageId
          ? messages.filter((m) => m.id !== continueFromMessageId)
          : messages

        // Apply fuller reply detail to saved assistants too; code itself stays focused.
        const builder = new CompletionMessagesBuilder(
          contextMessages,
          withCodingRule(
            withAnswerDetail(
              currentAssistant
                ? withDocuments(
                    renderInstructions(currentAssistant.instructions),
                    currentAssistant.documents
                  )
                : undefined
            ),
            message
          )
        )
        // Using addUserMessage to respect legacy code. Should be using the userContent above.
        if (troubleshooting && !continueFromMessageId) {
          builder.addUserMessage(userContent)
        } else if (continueFromMessage) {
          // When continuing, add the partial assistant response to the context
          builder.addAssistantMessage(
            continueFromMessage.content?.[0]?.text?.value || '',
            undefined,
            []
          )
        }

        let isCompleted = false

        const disabledTools = getDisabledToolsForThread(activeThread.id)
        const isToolDisabled = (tool: MCPTool) => {
          const compositeKey = `${tool.server}::${tool.name}`
          return (
            disabledTools.includes(compositeKey) ||
            // Backwards compatibility with pre-migration keys
            disabledTools.includes(tool.name)
          )
        }

        // Filter tools based on model capabilities and available tools for this thread
        let availableTools = selectedModel?.capabilities?.includes('tools')
          ? useAppState.getState().tools.filter((tool) => !isToolDisabled(tool))
          : []

        // Conditionally inject RAG if tools are supported and documents are attached
        const ragFeatureAvailable =
          useAttachments.getState().enabled &&
          PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS]
        // Check if documents were attached in the current thread
        const hasDocuments = useThreads
          .getState()
          .getThreadById(activeThread.id)?.metadata?.hasDocuments
        if (hasDocuments && ragFeatureAvailable) {
          try {
            const ragTools = await serviceHub
              .rag()
              .getTools()
              .catch(() => [])
            if (Array.isArray(ragTools) && ragTools.length) {
              const enabledRagTools = ragTools.filter(
                (tool) => !isToolDisabled(tool)
              )
              availableTools = [...availableTools, ...enabledRagTools]
              console.log('RAG tools injected for completion.')
            }
          } catch (e) {
            console.warn('Failed to inject RAG tools:', e)
          }
        }

        // Check if proactive mode is enabled in MCP settings and model has required capabilities
        const hasRequiredCapabilities =
          (selectedModel?.capabilities?.includes('vision') ?? false) &&
          (selectedModel?.capabilities?.includes('tools') ?? false)
        const isProactiveMode =
          mcpSettings.proactiveMode && hasRequiredCapabilities

        // Proactive mode: Capture initial screenshot/snapshot before first LLM call
        if (
          isProactiveMode &&
          availableTools.length > 0 &&
          !abortController.signal.aborted
        ) {
          console.log(
            'Proactive mode: Capturing initial screenshots before LLM call'
          )
          try {
            const initialScreenshots =
              await captureProactiveScreenshots(abortController)

            // Add initial screenshots to builder
            for (const screenshot of initialScreenshots) {
              // Generate unique tool call ID for initial screenshot
              const proactiveToolCallId = `proactive_initial_${Date.now()}_${Math.random()}`
              builder.addToolMessage(screenshot, proactiveToolCallId)
              console.log('Initial proactive screenshot added to context')
            }
          } catch (e) {
            console.warn('Failed to capture initial proactive screenshots:', e)
          }
        }

        // let assistantLoopSteps = 0
        let webEvidence: WebEvidence | undefined

        while (
          !isCompleted &&
          !abortController.signal.aborted &&
          activeProvider
        ) {
          if (!continueFromMessageId) {
            accumulatedTextRef.value = ''
          }
          const modelConfig = activeProvider.models.find(
            (m) => m.id === selectedModel?.id
          )
          // assistantLoopSteps += 1

          const modelSettings = modelConfig?.settings
            ? Object.fromEntries(
                Object.entries(modelConfig.settings)
                  .filter(
                    ([key, value]) =>
                      key !== 'ctx_len' &&
                      key !== 'ngl' &&
                      value.controller_props?.value !== undefined &&
                      value.controller_props?.value !== null &&
                      value.controller_props?.value !== ''
                  )
                  .map(([key, value]) => [key, value.controller_props?.value])
              )
            : undefined

          const requestStart = Date.now()
          const streamTiming: StreamTiming = {
            hiddenAtStart: pageHidden(),
            attempts: [],
          }
          const originalMessages = builder.getMessages()
          let requestMessages = originalMessages
          const track: NonNullable<Parameters<typeof sendCompletion>[7]> = {
            attempts: streamTiming.attempts!,
            start: requestStart,
          }
          const autoState = useChatAuto.getState()
          if (autoState.auto) streamTiming.autoMode = autoState.mode
          if (autoState.auto && autoState.mode === 'accuracy') {
            accuracyRequested = true
            useAppState.getState().setAccuracyStatus({
              threadId: activeThread.id,
              phase: webEvidence ? 'drafting' : 'searching',
            })
            if (!webEvidence) {
              // Web pages can't answer questions about the candidate themselves.
              webEvidence = isPersonalQuestion(message)
                ? personalEvidence()
                : await getWebEvidence(
                    buildAccuracyQuery(message, getMessages(activeThread.id)),
                    abortController.signal
                  )
            }
            if (abortController.signal.aborted)
              throw abortController.signal.reason
            requestMessages = groundAccuracyMessages(
              originalMessages,
              webEvidence
            )
            useAppState.getState().setAccuracyStatus({
              threadId: activeThread.id,
              phase: 'drafting',
            })
          }
          const draftStartedAt = Date.now()
          // With a Claude provider, Accuracy streams Claude's answer from the
          // same sources. Images and attached chat documents (which need tools
          // Claude isn't given here) keep the gpt-oss draft and review, as
          // does any Claude error or slow start.
          const claudeKey =
            autoState.auto && autoState.mode === 'accuracy'
              ? anthropicConfig(useModelProvider.getState().providers)
              : {}
          let claudeDirect:
            | Awaited<ReturnType<typeof claudeAccuracyAnswer>>
            | undefined
          if (
            claudeKey.apiKey &&
            webEvidence &&
            !hasImages(requestMessages) &&
            !hasDocuments &&
            !continueFromMessageId
          ) {
            try {
              claudeDirect = await claudeAccuracyAnswer({
                apiKey: claudeKey.apiKey,
                baseUrl: claudeKey.baseUrl,
                messages: requestMessages as {
                  role: string
                  content?: unknown
                }[],
                evidence: webEvidence,
                signal: abortController.signal,
                requestStart,
                onDone: (review) =>
                  reportSpeech(
                    accuracyLogLine(review, Date.now() - requestStart)
                  ),
              })
            } catch (error) {
              if (abortController.signal.aborted) throw error
              console.warn('[accuracy] Claude answer failed, using gpt-oss', {
                reason: error instanceof Error ? error.message : 'unknown',
              })
            }
          }
          // Auto's first-answer race requires streaming; manual models retain their setting.
          const streamReply =
            autoState.auto || currentAssistant?.parameters?.stream !== false
          const attemptTracks = new Map<string, typeof track>()
          const sendTo = (
            provider: ModelProvider,
            modelId: string | undefined,
            controller: AbortController,
            attemptTrack = track,
            autoReasoning?: 'low' | 'medium'
          ) =>
            sendCompletion(
              modelId &&
                (modelId !== activeThread.model?.id ||
                  provider.provider !== activeThread.model?.provider)
                ? {
                    ...activeThread,
                    model: { id: modelId, provider: provider.provider },
                  }
                : activeThread,
              provider,
              withMediumLength(requestMessages, modelId),
              controller,
              availableTools,
              streamReply,
              {
                ...modelSettings,
                ...(currentAssistant?.parameters || {}),
                ...(autoReasoning ? { reasoning_effort: autoReasoning } : {}),
              } as unknown as Record<string, object>,
              attemptTrack
            )
          // Auto modes only use Groq and Cerebras. Manual selection keeps its provider.
          const chain = autoState.auto
            ? autoChain()
                .map((c) => ({ ...c, provider: getProviderByName(c.provider) }))
                .filter(
                  (c): c is typeof c & { provider: ModelProvider } =>
                    !!c.provider?.api_key
                )
            : []
          if (autoState.auto && !chain.length)
            throw new Error(
              'Configure a Groq or Cerebras API key to use Auto, or select a model manually'
            )
          if (!chain.length && activeThread.model?.id)
            chain.push({
              provider: activeProvider,
              model: activeThread.model.id,
            })
          const tries = chain
            // Image questions go to each provider's one vision model, so
            // try each provider once
            .filter(
              (c, i, all) =>
                !hasImages(requestMessages) ||
                all.findIndex(
                  (o) => o.provider.provider === c.provider.provider
                ) === i
            )
          const attempt = async (
            c: (typeof tries)[number],
            controller: AbortController
          ) => {
            if (c.provider.provider === 'anthropic')
              return (await streamClaude({
                apiKey: c.provider.api_key!,
                baseUrl: c.provider.base_url,
                model: c.model,
                messages: requestMessages as {
                  role: string
                  content?: unknown
                }[],
                signal: controller.signal,
              })) as unknown as AsyncIterable<chatCompletionChunk>
            const attemptTrack: typeof track = {
              attempts: track.attempts,
              start: track.start,
            }
            attemptTracks.set(`${c.provider.provider}:${c.model}`, attemptTrack)
            const res = await sendTo(
              c.provider,
              c.model,
              controller,
              attemptTrack,
              autoState.auto && !hasImages(requestMessages)
                ? autoState.mode === 'speed'
                  ? 'low'
                  : 'medium'
                : undefined
            )
            if (!res) throw new Error('No completion received')
            return res as unknown as AsyncIterable<chatCompletionChunk>
          }
          let winnerIndex = 0
          let completion = claudeDirect
            ? (claudeDirect.completion as unknown as AsyncIterable<chatCompletionChunk>)
            : autoState.auto &&
                streamReply &&
                tries.some(
                  (c) =>
                    c.provider.provider === 'groq' ||
                    c.provider.provider === 'cerebras'
                )
              ? await raceAutoAnswers(
                  tries.map((c) => ({
                    model: c.model,
                    tier:
                      c.model === 'openai/gpt-oss-20b'
                        ? ('small' as const)
                        : ('large' as const),
                    run: (controller: AbortController) =>
                      attempt(c, controller),
                  })),
                  autoState.mode,
                  abortController.signal,
                  (index, event, reason) => {
                    if (event === 'winner') {
                      winnerIndex = index
                      const events = streamTiming.autoEvents ?? []
                      const first = events.find(
                        (entry) =>
                          entry.model === tries[index].model &&
                          entry.provider === tries[index].provider.provider &&
                          entry.event === 'first-chunk'
                      )
                      const ready = events.find(
                        (entry) =>
                          entry.model === tries[index].model &&
                          entry.provider === tries[index].provider.provider &&
                          entry.event === 'answer-ready'
                      )
                      if (first) {
                        streamTiming.firstChunkAt = requestStart + first.atMs
                        streamTiming.hiddenAtFirstChunk = first.hidden
                      }
                      if (ready)
                        streamTiming.firstAnswerAt = requestStart + ready.atMs
                    }
                    streamTiming.autoEvents = [
                      ...(streamTiming.autoEvents ?? []),
                      {
                        model: tries[index].model,
                        provider: tries[index].provider.provider,
                        event,
                        ...(event === 'first-chunk'
                          ? { hidden: pageHidden() }
                          : {}),
                        atMs: Date.now() - requestStart,
                        ...(reason ? { reason } : {}),
                      },
                    ]
                  }
                ).then((result) => result.stream)
              : tries[0]?.provider.provider === 'anthropic'
                ? await attempt(tries[0], abortController)
                : await sendTo(
                    tries[0]?.provider ?? activeProvider,
                    tries[0]?.model ?? activeThread.model?.id,
                    abortController
                  )

          if (!completion) throw new Error('No completion received')
          const winner = tries[winnerIndex]
          let accuracyReview: AccuracyReview | undefined
          if (claudeDirect) {
            accuracyReview = claudeDirect.review
            useAppState.getState().setAccuracyStatus(undefined)
          } else if (autoState.auto && autoState.mode === 'accuracy') {
            const checked = await verifyAccuracyCompletion(
              completion,
              activeThread,
              originalMessages,
              useModelProvider.getState().providers,
              winner?.provider.provider ?? activeProvider.provider,
              abortController.signal,
              webEvidence!,
              (phase) =>
                useAppState
                  .getState()
                  .setAccuracyStatus({ threadId: activeThread.id, phase }),
              accumulatedTextRef.value,
              draftStartedAt,
              winner?.model
            )
            completion = checked.completion
            accuracyReview = checked.review
            if (accuracyReview)
              reportSpeech(
                accuracyLogLine(accuracyReview, Date.now() - requestStart)
              )
            if (accuracyReview) accumulatedTextRef.value = ''
            // Draft readiness is not the time the verified answer becomes visible.
            if (accuracyReview) {
              streamTiming.firstChunkAt = undefined
              streamTiming.firstAnswerAt = undefined
              streamTiming.hiddenAtFirstChunk = undefined
            }
            useAppState.getState().setAccuracyStatus(undefined)
          }
          const winnerTrack = winner
            ? attemptTracks.get(`${winner.provider.provider}:${winner.model}`)
            : undefined
          if (winnerTrack?.sent) track.sent = winnerTrack.sent
          const answered =
            accuracyReview && accuracyReview.verdict !== 'approved'
              ? accuracyReview.model
              : (track.sent?.model ?? winner?.model)
          const currentCall: ChatCompletionMessageToolCall | null = null
          const toolCalls: ChatCompletionMessageToolCall[] = []
          const timeToFirstToken = Date.now()
          let tokenUsage: CompletionUsage | undefined = undefined
          const tokenUsageRef = { current: tokenUsage }
          try {
            if (isCompletionResponse(completion)) {
              const message = completion.choices[0]?.message
              const newContent = (message?.content as string) || ''
              if (
                continueFromMessageId &&
                accumulatedTextRef.value.length > 0
              ) {
                accumulatedTextRef.value += newContent
              } else {
                accumulatedTextRef.value = newContent
              }

              // Handle reasoning field if there is one
              const reasoning = extractReasoningFromMessage(message)
              if (reasoning) {
                accumulatedTextRef.value =
                  `<think>${reasoning}</think>` + accumulatedTextRef.value
              }

              if (message?.tool_calls) {
                toolCalls.push(...message.tool_calls)
              }
              if ('usage' in completion) {
                tokenUsage = completion.usage
              }
            } else {
              await processStreamingCompletion(
                completion,
                abortController,
                activeThread,
                accumulatedTextRef,
                toolCalls,
                currentCall,
                updateStreamingContent,
                updateTokenSpeed,
                setTokenSpeed,
                updatePromptProgress,
                timeToFirstToken,
                tokenUsageRef,
                continueFromMessageId,
                updateMessage,
                continueFromMessage,
                streamTiming
              )
              tokenUsage = tokenUsageRef.current
            }
          } catch (error) {
            const errorMessage =
              error && typeof error === 'object' && 'message' in error
                ? error.message
                : error
            if (
              typeof errorMessage === 'string' &&
              errorMessage.includes(OUT_OF_CONTEXT_SIZE) &&
              selectedModel
            ) {
              const method = await showIncreaseContextSizeModal()
              if (method === 'ctx_len') {
                /// Increase context size
                activeProvider = await increaseModelContextSize(
                  selectedModel.id,
                  activeProvider
                )
                continue
              } else if (method === 'context_shift' && selectedModel?.id) {
                /// Enable context_shift
                activeProvider = await toggleOnContextShifting(
                  selectedModel?.id,
                  activeProvider
                )
                continue
              } else throw error
            } else {
              throw error
            }
          }
          // TODO: Remove this check when integrating new llama.cpp extension
          if (
            accumulatedTextRef.value.length === 0 &&
            toolCalls.length === 0 &&
            activeThread.model?.id &&
            activeProvider?.provider === 'llamacpp'
          ) {
            await serviceHub
              .models()
              .stopModel(activeThread.model.id, 'llamacpp')

            // Refresh active models after stopping
            serviceHub
              .models()
              .getActiveModels()
              .then((models) => setActiveModels(models || []))
            throw new Error('No response received from the model')
          }

          const timings = describeTiming(
            requestStart,
            Date.now(),
            streamTiming,
            {
              messages: (track.sent?.messages ?? requestMessages).length,
              chars: JSON.stringify(track.sent?.messages ?? requestMessages)
                .length,
              tools: availableTools.length,
              model: answered,
            }
          )
          console.info(
            '[chat] reply timings',
            timings,
            ...(accuracyReview
              ? [
                  {
                    accuracy_review: {
                      verifier: accuracyReview.verifier,
                      verdict: accuracyReview.verdict,
                      draft_ms: accuracyReview.draftMs,
                      search_ms: accuracyReview.searchMs,
                      review_ms: accuracyReview.reviewMs,
                      web_status: accuracyReview.webStatus,
                      source_count: accuracyReview.sources.length,
                      claim_count: accuracyReview.claimCount,
                      source_claim_count: accuracyReview.sourceClaimCount,
                      qualified_claim_count: accuracyReview.qualifiedClaimCount,
                      unsupported_claim_count:
                        accuracyReview.unsupportedClaimCount,
                      fallback: accuracyReview.fallback,
                      failure_reasons: accuracyReview.failureReasons,
                    },
                  },
                ]
              : [])
          )

          if (autoState.auto && autoState.mode === 'speed')
            reportSpeech(speedLogLine(timings))

          // Create a final content object for adding to the thread
          let finalContent = newAssistantThreadContent(
            activeThread.id,
            accumulatedTextRef.value,
            {
              tokenSpeed: useAppState.getState().tokenSpeed,
              assistant: withoutDocuments(currentAssistant),
              modelId: answered ?? selectedModel?.id,
              timings,
              ...(accuracyReview ? { accuracyReview } : {}),
            }
          )

          // If continuing from a message, preserve the ID and set status to Ready
          if (continueFromMessageId) {
            finalContent = {
              ...finalContent,
              id: continueFromMessageId,
              status: MessageStatus.Ready,
            }
          }

          // Normal completion flow (abort is handled after loop exits)
          // Don't add assistant message to builder if continuing - it's already there
          if (!continueFromMessageId) {
            builder.addAssistantMessage(
              accumulatedTextRef.value,
              undefined,
              toolCalls
            )
          }

          // Check if proactive mode is enabled in MCP settings and model has required capabilities
          const hasRequiredCapabilitiesForPostProcessing =
            (selectedModel?.capabilities?.includes('vision') ?? false) &&
            (selectedModel?.capabilities?.includes('tools') ?? false)
          const isProactiveModeForPostProcessing =
            mcpSettings.proactiveMode &&
            hasRequiredCapabilitiesForPostProcessing
          const updatedMessage = await postMessageProcessing(
            toolCalls,
            builder,
            finalContent,
            abortController,
            useToolApproval.getState().approvedTools,
            allowAllMCPPermissions ? undefined : showApprovalModal,
            allowAllMCPPermissions,
            isProactiveModeForPostProcessing
          )
          finalizeMessage(
            updatedMessage ?? finalContent,
            addMessage,
            updateStreamingContent,
            updatePromptProgress,
            updateThreadTimestamp,
            updateMessage,
            continueFromMessageId
          )

          isCompleted = !toolCalls.length
          // // Do not create agent loop if there is no need for it
          // // Check if assistant loop steps are within limits
          // if (assistantLoopSteps >= (currentAssistant?.tool_steps ?? 20)) {
          //   // Stop the assistant tool call if it exceeds the maximum steps
          //   availableTools = []
          // }
        }

        // IMPORTANT: Check if aborted AFTER the while loop exits
        // The while loop exits when abort is true, so we handle it here
        // Only save interrupted messages for llamacpp provider
        // Other providers (OpenAI, Claude, etc.) handle streaming differently
        if (
          abortController.signal.aborted &&
          accumulatedTextRef.value.length > 0 &&
          activeProvider?.provider === 'llamacpp'
        ) {
          // If continuing, update the existing message; otherwise add new
          if (continueFromMessageId && continueFromMessage) {
            // Preserve the original message metadata
            updateMessage({
              ...continueFromMessage,
              content: [
                {
                  type: ContentType.Text,
                  text: {
                    value: accumulatedTextRef.value,
                    annotations: [],
                  },
                },
              ],
              status: MessageStatus.Stopped,
              metadata: {
                ...continueFromMessage.metadata,
                tokenSpeed: useAppState.getState().tokenSpeed,
                assistant: withoutDocuments(currentAssistant),
                modelId: selectedModel?.id,
              },
            })
          } else {
            // Create final content for the partial message with Stopped status
            const partialContent = {
              ...newAssistantThreadContent(
                activeThread.id,
                accumulatedTextRef.value,
                {
                  tokenSpeed: useAppState.getState().tokenSpeed,
                  assistant: withoutDocuments(currentAssistant),
                  modelId: selectedModel?.id,
                }
              ),
              status: MessageStatus.Stopped,
            }
            addMessage(partialContent)
          }
          updatePromptProgress(undefined)
          updateThreadTimestamp(activeThread.id)
        }
      } catch (error) {
        // If aborted, save the partial message even though an error occurred
        // Only save for llamacpp provider - other providers handle streaming differently
        const streamingContent = useAppState.getState().streamingContent
        const hasPartialContent =
          accumulatedTextRef.value.length > 0 ||
          (streamingContent && streamingContent.content?.[0]?.text?.value)

        if (
          abortController.signal.aborted &&
          hasPartialContent &&
          activeProvider?.provider === 'llamacpp'
        ) {
          // Use streaming content if available, otherwise use accumulatedTextRef
          const contentText =
            streamingContent?.content?.[0]?.text?.value ||
            accumulatedTextRef.value

          // If continuing, update the existing message; otherwise add new
          if (continueFromMessageId && continueFromMessage) {
            // Preserve the original message metadata
            updateMessage({
              ...continueFromMessage,
              content: [
                {
                  type: ContentType.Text,
                  text: {
                    value: contentText,
                    annotations: [],
                  },
                },
              ],
              status: MessageStatus.Stopped,
              metadata: {
                ...continueFromMessage.metadata,
                tokenSpeed: useAppState.getState().tokenSpeed,
                assistant: withoutDocuments(currentAssistant),
                modelId: selectedModel?.id,
              },
            })
          } else {
            const partialContent = {
              ...newAssistantThreadContent(activeThread.id, contentText, {
                tokenSpeed: useAppState.getState().tokenSpeed,
                assistant: withoutDocuments(currentAssistant),
                modelId: selectedModel?.id,
              }),
              status: MessageStatus.Stopped,
            }
            addMessage(partialContent)
          }
          updatePromptProgress(undefined)
          updateThreadTimestamp(activeThread.id)
        } else if (!abortController.signal.aborted) {
          // Only show error if not aborted
          if (error && typeof error === 'object' && 'message' in error) {
            setModelLoadError(error as ErrorObject)
          } else {
            setModelLoadError(`${error}`)
          }
        }
      } finally {
        if (
          useAppState.getState().accuracyStatus?.threadId === activeThread.id
        ) {
          useAppState.getState().setAccuracyStatus(undefined)
        }
        if (accuracyRequested) abortController.abort()
        updateLoadingModel(false)
        updateStreamingContent(undefined)
        updatePromptProgress(undefined)
      }
    },
    [
      getCurrentThread,
      resetTokenSpeed,
      getProviderByName,
      getMessages,
      setAbortController,
      updateStreamingContent,
      updatePromptProgress,
      addMessage,
      updateMessage,
      updateThreadTimestamp,
      updateLoadingModel,
      getDisabledToolsForThread,
      allowAllMCPPermissions,
      showApprovalModal,
      updateTokenSpeed,
      showIncreaseContextSizeModal,
      increaseModelContextSize,
      ensureModelLoaded,
      toggleOnContextShifting,
      setModelLoadError,
      serviceHub,
      setTokenSpeed,
      mcpSettings.proactiveMode,
      setActiveModels,
    ]
  )

  return useMemo(() => sendMessage, [sendMessage])
}
