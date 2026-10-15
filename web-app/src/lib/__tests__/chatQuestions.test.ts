import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadMessage } from '@janhq/core'
import {
  collectChatPrompts,
  extractChatQuestions,
  parseChatQuestions,
  questionBatches,
} from '../chatQuestions'
import { sendCompletion } from '../completion'
vi.mock('../completion', () => ({
  sendCompletion: vi.fn(),
  isCompletionResponse: (response: unknown) =>
    !!response && typeof response === 'object' && 'choices' in response,
}))
const providers = [
  { provider: 'cerebras', api_key: 'test' },
  { provider: 'groq', api_key: 'test' },
] as ModelProvider[]
const thread = { id: 'chat' } as Thread
const response = (questions: unknown[]) => ({
  choices: [{ message: { content: JSON.stringify({ questions }) } }],
})

describe('chat question extraction', () => {
  afterEach(() => vi.resetAllMocks())
  it('collects only user text, removes file metadata and excludes attachments and answers', () => {
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: {
              value:
                'Why ECS?\n\n[ATTACHED_FILES]\n- file_id: f, name: notes.txt\n[/ATTACHED_FILES]',
            },
          },
          { type: 'image_url', image_url: { url: 'private-image' } },
        ],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: { value: 'Private answer' } }],
      },
      {
        role: 'tool',
        content: [{ type: 'text', text: { value: 'Private tool output' } }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: { value: 'Which is cheaper?' } }],
      },
    ] as ThreadMessage[]
    expect(collectChatPrompts(messages)).toEqual([
      { promptIndex: 1, text: 'Why ECS?' },
      { promptIndex: 2, text: 'Which is cheaper?' },
    ])
  })
  it('includes every character of lengthy prompts across bounded requests', () => {
    const prompts = [
      { promptIndex: 1, text: 'a'.repeat(50_000) },
      { promptIndex: 2, text: 'What is DNS?' },
    ]
    const batches = questionBatches(prompts)
    expect(
      batches.every(
        (batch) =>
          batch.reduce((sum, prompt) => sum + prompt.text.length, 0) <= 24_000
      )
    ).toBe(true)
    expect(
      batches
        .flat()
        .filter((prompt) => prompt.promptIndex === 1)
        .map((prompt) => prompt.text)
        .join('')
    ).toBe(prompts[0].text)
    expect(batches.flat().at(-1)).toEqual(prompts[1])
  })
  it('rejects invented sources and paraphrased question text', () => {
    const prompts = [{ promptIndex: 1, text: 'Why ECS? Which is cheaper?' }]
    expect(() =>
      parseChatQuestions(
        JSON.stringify({ questions: [{ promptIndex: 2, text: 'Why ECS?' }] }),
        prompts
      )
    ).toThrow()
    expect(() =>
      parseChatQuestions(
        JSON.stringify({
          questions: [{ promptIndex: 1, text: 'Why use Kubernetes?' }],
        }),
        prompts
      )
    ).toThrow()
  })
  it('recovers an invalid primary result using Groq 120B and preserves question order', async () => {
    vi.mocked(sendCompletion)
      .mockResolvedValueOnce(
        response([{ promptIndex: 99, text: 'Invented' }]) as never
      )
      .mockResolvedValueOnce(
        response([
          { promptIndex: 1, text: 'Which is cheaper?' },
          { promptIndex: 1, text: 'Why ECS?' },
          { promptIndex: 1, text: 'Why ECS?' },
        ]) as never
      )
    const questions = await extractChatQuestions(
      thread,
      [{ promptIndex: 1, text: 'Why ECS? Which is cheaper?' }],
      providers,
      new AbortController().signal
    )
    expect(questions).toEqual([
      { promptIndex: 1, text: 'Why ECS?' },
      { promptIndex: 1, text: 'Which is cheaper?' },
    ])
    expect(vi.mocked(sendCompletion).mock.calls[1][0].model?.id).toBe(
      'openai/gpt-oss-120b'
    )
    expect(
      vi
        .mocked(sendCompletion)
        .mock.calls.every((args) => args[4]?.length === 0 && args[5] === false)
    ).toBe(true)
  })
  it('accepts a question the judge ended with a question mark', () => {
    const prompts = [{ promptIndex: 1, text: 'tell me about your project' }]
    expect(
      parseChatQuestions(
        JSON.stringify({
          questions: [{ promptIndex: 1, text: 'Tell me about your project?' }],
        }),
        [{ promptIndex: 1, text: 'Tell me about your project' }]
      )
    ).toEqual([{ promptIndex: 1, text: 'Tell me about your project?' }])
    expect(() =>
      parseChatQuestions(
        JSON.stringify({
          questions: [{ promptIndex: 1, text: 'Tell me about yourself?' }],
        }),
        prompts
      )
    ).toThrow()
  })
  it('keeps the exactly quoted questions when every judge misquotes one', async () => {
    vi.mocked(sendCompletion)
      .mockResolvedValueOnce(
        response([
          { promptIndex: 1, text: 'Why ECS?' },
          { promptIndex: 1, text: 'Why use Kubernetes?' },
        ]) as never
      )
      .mockResolvedValueOnce(
        response([{ promptIndex: 7, text: 'Hi' }]) as never
      )
    const questions = await extractChatQuestions(
      thread,
      [{ promptIndex: 1, text: 'Why ECS? Which is cheaper?' }],
      providers,
      new AbortController().signal
    )
    expect(questions).toEqual([{ promptIndex: 1, text: 'Why ECS?' }])
  })
  it('lists the prompts as sent when every judge fails', async () => {
    vi.mocked(sendCompletion).mockRejectedValue(new Error('429'))
    const questions = await extractChatQuestions(
      thread,
      [
        { promptIndex: 1, text: 'Why ECS?' },
        { promptIndex: 2, text: 'How do you deploy it?' },
      ],
      providers,
      new AbortController().signal
    )
    expect(questions).toEqual([
      { promptIndex: 1, text: 'Why ECS?' },
      { promptIndex: 2, text: 'How do you deploy it?' },
    ])
  })
  it('cancels a provider that ignores abort without trying the next provider', async () => {
    vi.mocked(sendCompletion).mockImplementation(() => new Promise(() => {}))
    const controller = new AbortController()
    const result = extractChatQuestions(
      thread,
      [{ promptIndex: 1, text: 'Why ECS?' }],
      providers,
      controller.signal
    )
    await Promise.resolve()
    controller.abort(new Error('Cancelled'))
    await expect(result).rejects.toThrow('Cancelled')
    expect(sendCompletion).toHaveBeenCalledTimes(1)
  })
})
