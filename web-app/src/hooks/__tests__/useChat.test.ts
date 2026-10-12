import { useChatAuto } from '@/lib/chatModels'
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MessageStatus, ContentType } from '@janhq/core'

let autoProviders: Record<string, any> = {}

// Initialize mock functions immediately for use in vi.mock
const mockAddMessage = vi.fn()
const mockUpdateMessage = vi.fn()
const mockGetMessages = vi.fn(() => [])
const mockStartModel = vi.fn(() => Promise.resolve())
const mockSendCompletion = vi.fn(() =>
  Promise.resolve({
    choices: [
      {
        message: {
          content: 'AI response',
          role: 'assistant',
        },
      },
    ],
  })
)
const mockPostMessageProcessing = vi.fn((toolCalls, builder, content) =>
  Promise.resolve(content)
)
const mockRetrieveThread = vi.fn((): unknown => ({
  id: 'test-thread',
  model: { id: 'test-model', provider: 'llamacpp' },
}))
const mockCreateThread = vi.fn(() =>
  Promise.resolve({
    id: 'test-thread',
    model: { id: 'test-model', provider: 'llamacpp' },
  })
)
const mockCompletionMessagesBuilder = {
  addUserMessage: vi.fn(),
  addAssistantMessage: vi.fn(),
  getMessages: vi.fn(() => []),
}
const mockSetPrompt = vi.fn()
const mockResetTokenSpeed = vi.fn()

// Mock dependencies
vi.mock('../usePrompt', () => ({
  usePrompt: Object.assign(
    (selector: any) => {
      const state = {
        prompt: 'test prompt',
        setPrompt: mockSetPrompt,
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        prompt: 'test prompt',
        setPrompt: mockSetPrompt,
      }),
    }
  ),
}))

vi.mock('../useAppState', () => ({
  useAppState: Object.assign(
    (selector?: any) => {
      const state = {
        tools: [],
        updateTokenSpeed: vi.fn(),
        resetTokenSpeed: mockResetTokenSpeed,
        updateTools: vi.fn(),
        updateStreamingContent: vi.fn(),
        updatePromptProgress: vi.fn(),
        updateLoadingModel: vi.fn(),
        setAbortController: vi.fn(),
        streamingContent: undefined,
        setAccuracyStatus: vi.fn(),
        setTokenSpeed: vi.fn(), // Added setTokenSpeed mock
        setActiveModels: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    {
      getState: vi.fn(() => ({
        tools: [],
        tokenSpeed: { tokensPerSecond: 10 },
        streamingContent: undefined,
        setAccuracyStatus: vi.fn(),
      })),
    }
  ),
}))

vi.mock('../useAssistant', () => ({
  useAssistant: Object.assign(
    (selector: any) => {
      const state = {
        assistants: [
          {
            id: 'test-assistant',
            instructions: 'test instructions',
            parameters: { stream: true },
          },
        ],
        currentAssistant: {
          id: 'test-assistant',
          instructions: 'test instructions',
          parameters: { stream: true },
        },
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        assistants: [
          {
            id: 'test-assistant',
            instructions: 'test instructions',
            parameters: { stream: true },
          },
        ],
        currentAssistant: {
          id: 'test-assistant',
          instructions: 'test instructions',
          parameters: { stream: true },
        },
      }),
    }
  ),
}))

vi.mock('../useModelProvider', () => ({
  useModelProvider: Object.assign(
    (selector: any) => {
      const state = {
        getProviderByName: vi.fn(
          (name: string) =>
            autoProviders[name] ?? {
              provider: 'llamacpp',
              // FIX: Add a model to the provider to allow execution to proceed
              models: [
                {
                  id: 'test-model',
                  capabilities: ['tools', 'vision'],
                  settings: {},
                },
              ],
              settings: [],
            }
        ),
        selectedModel: {
          id: 'test-model',
          capabilities: ['tools', 'vision'],
        },
        selectedProvider: 'llamacpp',
        updateProvider: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        providers: Object.values(autoProviders),
        getProviderByName: vi.fn(
          (name: string) =>
            autoProviders[name] ?? {
              provider: 'llamacpp',
              // FIX: Add a model to the provider to allow execution to proceed
              models: [
                {
                  id: 'test-model',
                  capabilities: ['tools', 'vision'],
                  settings: {},
                },
              ],
              settings: [],
            }
        ),
        selectedModel: {
          id: 'test-model',
          capabilities: ['tools', 'vision'],
        },
        selectedProvider: 'llamacpp',
        updateProvider: vi.fn(),
      }),
    }
  ),
}))

vi.mock('../useThreads', () => ({
  useThreads: Object.assign(
    (selector: any) => {
      const state = {
        getCurrentThread: mockRetrieveThread,
        createThread: mockCreateThread,
        updateThreadTimestamp: vi.fn(),
      }
      return selector ? selector(state) : state
    },
    {
      subscribe: vi.fn(() => () => {}),
      getState: () => ({
        getThreadById: vi.fn(() => ({
          id: 'test-thread',
          metadata: { hasDocuments: false },
        })),
      }),
    }
  ),
}))

vi.mock('../useMessages', () => ({
  useMessages: (selector: any) => {
    const state = {
      getMessages: mockGetMessages,
      addMessage: mockAddMessage,
      updateMessage: mockUpdateMessage,
      setMessages: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../useToolApproval', () => ({
  useToolApproval: Object.assign(
    (selector: any) => {
      const state = {
        approvedTools: [],
        showApprovalModal: vi.fn(),
        allowAllMCPPermissions: false,
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        approvedTools: [],
        showApprovalModal: vi.fn(),
        allowAllMCPPermissions: false,
      }),
    }
  ),
}))

vi.mock('../useToolAvailable', () => ({
  useToolAvailable: (selector: any) => {
    const state = {
      getDisabledToolsForThread: vi.fn(() => []),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../useModelContextApproval', () => ({
  useContextSizeApproval: (selector: any) => {
    const state = {
      showApprovalModal: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('../useModelLoad', () => ({
  useModelLoad: (selector: any) => {
    const state = {
      setModelLoadError: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: vi.fn(() => ({
    navigate: vi.fn(),
  })),
}))

vi.mock('../useServiceHub', () => ({
  useServiceHub: vi.fn(() => ({
    models: () => ({
      startModel: mockStartModel,
      stopModel: vi.fn(() => Promise.resolve()),
      stopAllModels: vi.fn(() => Promise.resolve()),
      getActiveModels: vi.fn(() => Promise.resolve([])),
    }),
    providers: () => ({
      updateSettings: vi.fn(() => Promise.resolve()),
    }),
    uploads: () => ({
      ingestImage: vi.fn(() => Promise.resolve({ id: 'img-id' })),
      ingestFileAttachment: vi.fn(() => Promise.resolve({ id: 'doc-id' })),
    }),
    rag: () => ({
      getTools: vi.fn(() => Promise.resolve([])),
    }),
  })),
}))

vi.mock('@/hooks/useAttachments', () => ({
  useAttachments: Object.assign(
    (selector: any) => {
      const state = {
        enabled: true,
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({ enabled: true }),
    }
  ),
}))

vi.mock('@/lib/platform/const', () => ({
  PlatformFeatures: { ATTACHMENTS: true },
}))
vi.mock('@/lib/platform/types', () => ({
  PlatformFeature: { ATTACHMENTS: 'ATTACHMENTS' },
}))

vi.mock('@/lib/completion', () => ({
  emptyThreadContent: { thread_id: 'test-thread', content: '' },
  extractToolCall: vi.fn(),
  newUserThreadContent: vi.fn((threadId, content) => ({
    thread_id: threadId,
    content: [
      { type: ContentType.Text, text: { value: content, annotations: [] } },
    ],
    role: 'user',
  })),
  newAssistantThreadContent: vi.fn((threadId, content, metadata) => ({
    metadata,
    thread_id: threadId,
    content: [
      { type: ContentType.Text, text: { value: content, annotations: [] } },
    ],
    role: 'assistant',
  })),
  sendCompletion: mockSendCompletion,
  postMessageProcessing: mockPostMessageProcessing,
  isCompletionResponse: vi.fn(() => true),
  captureProactiveScreenshots: vi.fn(() => Promise.resolve([])),
}))

vi.mock('@/lib/messages', () => ({
  CompletionMessagesBuilder: vi.fn(() => mockCompletionMessagesBuilder),
}))

vi.mock('@/lib/instructionTemplate', () => ({
  renderInstructions: vi.fn((instructions: string) => instructions),
}))

vi.mock('@/utils/reasoning', () => ({
  ReasoningProcessor: vi.fn(() => ({
    processReasoningChunk: vi.fn(() => null),
    finalize: vi.fn(() => ''),
  })),
  extractReasoningFromMessage: vi.fn(() => null),
}))

vi.mock('@/services/mcp', () => ({
  getTools: vi.fn(() => Promise.resolve([])),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

// Import after mocks to avoid hoisting issues
const { useChat } = await import('../useChat')
const completionLib = await import('@/lib/completion')
const messagesLib = await import('@/lib/messages')

describe('useChat', () => {
  beforeEach(() => {
    // Clear mock call history
    vi.clearAllMocks()
    autoProviders = {}
    useChatAuto.setState({ auto: false, mode: 'accuracy' })

    // Reset mock implementations
    mockGetMessages.mockReturnValue([])
    mockStartModel.mockResolvedValue(undefined)
    mockSendCompletion.mockReset()
    vi.mocked(completionLib.isCompletionResponse).mockReturnValue(true)
    mockSendCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'AI response',
            role: 'assistant',
          },
        },
      ],
    })
    mockPostMessageProcessing.mockImplementation(
      (toolCalls, builder, content) => Promise.resolve(content)
    )
    mockCompletionMessagesBuilder.getMessages.mockReturnValue([])
    // Reset mock implementations for builder methods
    mockCompletionMessagesBuilder.addUserMessage.mockClear()
    mockCompletionMessagesBuilder.addAssistantMessage.mockClear()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  it('returns sendMessage function', () => {
    const { result } = renderHook(() => useChat())

    expect(result.current).toBeDefined()
    expect(typeof result.current).toBe('function')
  })

  describe('new chat title', () => {
    it('names a new chat after the message sent, not the prompt box', async () => {
      // e.g. dictated text delivered while the box is empty
      // or holds an unrelated draft ('test prompt' in this mock)
      mockRetrieveThread.mockReturnValueOnce(undefined)
      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current('  What is the capital\nof Australia?  ', true)
      })

      expect(mockCreateThread).toHaveBeenCalledWith(
        expect.anything(),
        'What is the capital of Australia?',
        expect.anything(),
        undefined,
        false
      )
    })
  })

  describe('Continue with AI response functionality', () => {
    it('should add new user message when troubleshooting is true and no continueFromMessageId', async () => {
      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          'Hello world',
          true,
          undefined,
          undefined,
          undefined,
          undefined
        )
      })

      expect(completionLib.newUserThreadContent).toHaveBeenCalledWith(
        'test-thread',
        'Hello world',
        []
      )
      expect(mockAddMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          thread_id: 'test-thread',
          role: 'user',
        })
      )
      expect(mockCompletionMessagesBuilder.addUserMessage).toHaveBeenCalled()
    })

    it('should NOT add new user message when continueFromMessageId is provided', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial response', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      // userContent is still created but not added to messages when continuing
      const userMessageCalls = mockAddMessage.mock.calls.filter(
        (call: any) => call[0]?.role === 'user'
      )
      expect(userMessageCalls).toHaveLength(0)
      expect(
        mockCompletionMessagesBuilder.addUserMessage
      ).not.toHaveBeenCalled()
    })

    it('should add partial assistant message to builder when continuing', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial response', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      // When continuing, should call addAssistantMessage with the partial message content
      const assistantCalls =
        mockCompletionMessagesBuilder.addAssistantMessage.mock.calls
      expect(assistantCalls.length).toBeGreaterThanOrEqual(1)
      // First call should be with the partial response content
      expect(assistantCalls[0]).toEqual(['Partial response', undefined, []])
    })

    it('should filter out stopped message from context when continuing', async () => {
      const userMsg = {
        id: 'msg-1',
        thread_id: 'test-thread',
        role: 'user',
        content: [
          { type: ContentType.Text, text: { value: 'Hello', annotations: [] } },
        ],
      }
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
      }
      mockGetMessages.mockReturnValue([userMsg, stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      // When continuing, the CompletionMessagesBuilder should be called with messages
      // that exclude the stopped message from the context
      expect(messagesLib.CompletionMessagesBuilder).toHaveBeenCalled()
      const builderCall = (messagesLib.CompletionMessagesBuilder as any).mock
        .calls[0]
      expect(builderCall[0]).toEqual([userMsg]) // stopped message filtered out
      expect(builderCall[1]).toContain('test instructions')
    })

    it('should update existing message instead of adding new one when continuing', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      // When continuing, finalizeMessage should update the existing message
      // This test was failing because mockSendCompletion was not called due to the bad provider mock.
      expect(mockUpdateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-123',
          status: MessageStatus.Ready,
        })
      )
    })

    it('should start with previous content when continuing', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial response', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      mockSendCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: ' continued',
              role: 'assistant',
            },
          },
        ],
      })

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      // When continuing, the accumulated text should start with the previous partial content
      // and append new content from the completion
      // This test was failing because mockSendCompletion was not called due to the bad provider mock.
      expect(mockUpdateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-123',
          content: expect.arrayContaining([
            expect.objectContaining({
              text: expect.objectContaining({
                value: 'Partial response continued',
              }),
            }),
          ]),
        })
      )
    })

    it('should handle attachments correctly when not continuing', async () => {
      const { result } = renderHook(() => useChat())
      const attachments = [
        {
          name: 'test.png',
          type: 'image',
          size: 1024,
          base64: 'base64data',
          dataUrl: 'data:image/png;base64,base64data',
        } as any,
      ]

      await act(async () => {
        await result.current(
          'Message with attachment',
          true,
          attachments,
          undefined,
          undefined,
          undefined
        )
      })

      expect(completionLib.newUserThreadContent).toHaveBeenCalledWith(
        'test-thread',
        'Message with attachment',
        expect.arrayContaining([expect.objectContaining({ id: 'img-id' })])
      )
      expect(mockCompletionMessagesBuilder.addUserMessage).toHaveBeenCalled()
    })

    it('should preserve message status as Ready after continuation completes', async () => {
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      // After continuation completes, the message status should be set to Ready
      // This test was failing because mockSendCompletion was not called due to the bad provider mock.
      expect(mockUpdateMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-123',
          status: MessageStatus.Ready,
        })
      )
    })
  })

  describe('Groq/Cerebras Auto integration', () => {
    const configure = (mode: 'speed' | 'accuracy') => {
      vi.mocked(completionLib.isCompletionResponse).mockImplementation(
        (value: any) => !value?.[Symbol.asyncIterator]
      )
      autoProviders = {
        groq: { provider: 'groq', api_key: 'test-key', models: [] },
        cerebras: { provider: 'cerebras', api_key: 'test-key', models: [] },
      }
      useChatAuto.setState({ auto: true, mode })
    }
    it('races all three models in Speed with Low reasoning and saves only the winner', async () => {
      configure('speed')
      mockSendCompletion.mockImplementation(async (thread: any) =>
        (async function* () {
          if (thread.model.id !== 'openai/gpt-oss-20b')
            yield { choices: [{ delta: { reasoning_content: 'thinking' } }] }
          yield {
            choices: [{ delta: { content: `Answer from ${thread.model.id}` } }],
          }
        })()
      )
      const { result } = renderHook(() => useChat())
      await act(async () => {
        await result.current('Explain DNS.')
      })
      expect(
        mockSendCompletion.mock.calls.map((args: any[]) => args[0].model.id)
      ).toEqual(['gpt-oss-120b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
      for (const args of mockSendCompletion.mock.calls as any[][])
        expect(args[6]).toMatchObject({ reasoning_effort: 'low' })
      expect(mockAddMessage).toHaveBeenCalledTimes(2)
      const answer = mockAddMessage.mock.calls[1][0]
      expect(answer.content[0].text.value).toContain(
        'Answer from openai/gpt-oss-20b'
      )
      expect(answer.metadata.timings.answered_by).toBe('Groq gpt-oss-20b')
    })
    it('waits for web evidence, grounds both 120B drafts and reviews before saving an Accuracy answer', async () => {
      configure('accuracy')
      mockCompletionMessagesBuilder.getMessages.mockReturnValue([
        { role: 'user', content: 'Explain DNS.' },
      ] as any)
      let finishSearch!: (response: Response) => void
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
        () =>
          new Promise((resolve) => {
            finishSearch = resolve
          })
      )
      mockSendCompletion.mockImplementation(
        async (
          _thread: any,
          _provider: any,
          _messages: any,
          _abort: any,
          _tools: any,
          stream: boolean
        ) =>
          stream
            ? (async function* () {
                yield { choices: [{ delta: { content: 'Large answer' } }] }
              })()
            : {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        verdict: 'revised',
                        answer: '- Checked answer',
                        claims: [
                          {
                            text: 'Checked answer',
                            support: 'source',
                            sourceId: 1,
                            quote: 'Evidence',
                          },
                        ],
                        unsupportedClaims: ['Large answer'],
                      }),
                    },
                  },
                ],
              }
      )
      try {
        const { result } = renderHook(() => useChat())
        await act(async () => {
          const sending = result.current('Explain DNS.')
          await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
          expect(mockSendCompletion).not.toHaveBeenCalled()
          finishSearch(
            Response.json({
              status: 'ready',
              sources: [
                {
                  url: 'https://docs.example.com',
                  title: 'Docs',
                  text: 'Evidence',
                },
              ],
            })
          )
          await sending
        })
        expect(
          mockSendCompletion.mock.calls
            .slice(0, 2)
            .map((args: any[]) => args[0].model.id)
        ).toEqual(['gpt-oss-120b', 'openai/gpt-oss-120b'])
        for (const args of mockSendCompletion.mock.calls.slice(0, 2)) {
          expect(JSON.stringify(args[2])).toContain('Explain DNS.')
          expect(JSON.parse(args[2].at(-1).content).sources[0]).toMatchObject({
            sourceId: 1,
            text: 'Evidence',
          })
        }
        const review = mockSendCompletion.mock.calls[2]
        expect(review[5]).toBe(false)
        expect(review[4]).toEqual([])
        expect(review[6]).toMatchObject({ reasoning_effort: 'medium' })
        expect(mockAddMessage).toHaveBeenCalledTimes(2)
        expect(mockAddMessage.mock.calls[1][0].content[0].text.value).toBe(
          '- Checked answer'
        )
        expect(
          mockAddMessage.mock.calls[1][0].metadata.accuracyReview.verdict
        ).toBe('revised')
        expect(fetchSpy).toHaveBeenCalledWith('/api/search', expect.anything())
        expect(
          mockAddMessage.mock.calls[1][0].metadata.accuracyReview
        ).toMatchObject({
          sourceClaimCount: 1,
          unsupportedClaimCount: 1,
          searchMs: expect.any(Number),
        })
      } finally {
        fetchSpy.mockRestore()
      }
    })
    it('saves a recovered correction for assert_all instead of stopping at an audit error', async () => {
      configure('accuracy')
      const question =
        'there is this keyword called assert_all. It is in robot framework. Do you know what is the purpose of that assert_all?'
      const answer =
        'There is no standard BuiltIn keyword named Assert All. A custom library may expose assert_all under that name; its behavior depends on that library.'
      mockCompletionMessagesBuilder.getMessages.mockReturnValue([
        { role: 'user', content: question },
      ] as any)
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          Response.json({
            status: 'ready',
            sources: [
              {
                url: 'https://robotframework.org/docs',
                title: 'Robot Framework',
                text: 'Robot Framework supports custom keyword libraries.',
              },
            ],
          })
        )
      mockSendCompletion.mockImplementation(
        async (
          _thread: any,
          _provider: any,
          _messages: any,
          _abort: any,
          _tools: any,
          stream: boolean
        ) =>
          stream
            ? (async function* () {
                yield {
                  choices: [
                    {
                      delta: {
                        content: 'Assert All is built in and returns failures.',
                      },
                    },
                  ],
                }
              })()
            : {
                choices: [{ message: { content: JSON.stringify({ answer }) } }],
              }
      )
      try {
        const { result } = renderHook(() => useChat())
        await act(async () => {
          await result.current(question)
        })
        expect(mockAddMessage).toHaveBeenCalledTimes(2)
        const saved = mockAddMessage.mock.calls[1][0]
        expect(saved.content[0].text.value).toBe(answer)
        expect(saved.metadata.accuracyReview).toMatchObject({
          verdict: 'unverified',
          fallback: 'reviewer-answer',
        })
        expect(
          mockSendCompletion.mock.calls.filter((args) => args[5] === false)
        ).toHaveLength(2)
      } finally {
        fetchSpy.mockRestore()
      }
    })
    it('does not start a draft or reviewer without usable web sources', async () => {
      configure('accuracy')
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json({ status: 'ready', sources: [] }))
      try {
        const { result } = renderHook(() => useChat())
        await act(async () => {
          await result.current('What is assert_all?')
        })
        expect(mockSendCompletion).not.toHaveBeenCalled()
        expect(
          mockAddMessage.mock.calls.every((args) => args[0].role === 'user')
        ).toBe(true)
      } finally {
        fetchSpy.mockRestore()
      }
    })
    it('Speed still starts without a web search or evidence-review request', async () => {
      configure('speed')
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('Speed must not search'))
      mockSendCompletion.mockImplementation(async () =>
        (async function* () {
          yield { choices: [{ delta: { content: 'Fast answer' } }] }
        })()
      )
      try {
        const { result } = renderHook(() => useChat())
        await act(async () => {
          await result.current('Explain DNS.')
        })
        expect(fetchSpy).not.toHaveBeenCalled()
        expect(
          mockSendCompletion.mock.calls.every((args) => args[5] === true)
        ).toBe(true)
        expect(mockAddMessage.mock.calls[1][0].content[0].text.value).toBe(
          'Fast answer'
        )
      } finally {
        fetchSpy.mockRestore()
      }
    })
  })

  describe('Normal message sending', () => {
    it('sends message successfully without continuation', async () => {
      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current('Hello world')
      })

      // This test was failing because mockSendCompletion was not called due to the bad provider mock.
      expect(mockSendCompletion).toHaveBeenCalled()
      expect(mockStartModel).toHaveBeenCalled()
    })
  })

  describe('Error handling', () => {
    it('should handle errors gracefully during continuation', async () => {
      mockSendCompletion.mockRejectedValueOnce(new Error('API Error'))
      const stoppedMessage = {
        id: 'msg-123',
        thread_id: 'test-thread',
        role: 'assistant',
        content: [
          {
            type: ContentType.Text,
            text: { value: 'Partial', annotations: [] },
          },
        ],
        status: MessageStatus.Stopped,
        metadata: {},
      }
      mockGetMessages.mockReturnValue([stoppedMessage])

      const { result } = renderHook(() => useChat())

      await act(async () => {
        await result.current(
          '',
          true,
          undefined,
          undefined,
          undefined,
          'msg-123'
        )
      })

      expect(result.current).toBeDefined()
    })
  })
})
