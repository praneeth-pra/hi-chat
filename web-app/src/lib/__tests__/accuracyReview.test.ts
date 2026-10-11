import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  verifyAccuracyCompletion,
  getWebEvidence,
  buildAccuracyQuery,
} from '../accuracyReview'
import { sendCompletion } from '../completion'
import type { ChatCompletionResponse } from '../completion'
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
const evidence = Promise.resolve({
  status: 'ready' as const,
  sources: [
    {
      url: 'https://docs.example.com',
      title: 'Documentation',
      text: 'Technical evidence',
    },
  ],
})
const draft = () =>
  (async function* () {
    yield { choices: [{ delta: { content: 'Unverified draft' } }] }
  })() as ChatCompletionResponse
const response = (content: unknown) =>
  ({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }) as ChatCompletionResponse
const text = async (completion: ChatCompletionResponse) => {
  let result = ''
  for await (const chunk of completion as AsyncIterable<any>)
    result += chunk.choices[0].delta.content ?? ''
  return result
}

describe('Accuracy review gate', () => {
  afterEach(() => {
    vi.resetAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  it('gives search short follow-up context without sending assistant answers', () => {
    const history = [
      {
        role: 'user',
        content: [{ type: 'text', text: { value: 'Compare ECS and EKS.' } }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: { value: 'Private answer content' } }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: { value: 'Which is cheaper?' } }],
      },
    ] as import('@janhq/core').ThreadMessage[]
    const query = buildAccuracyQuery('Which is cheaper?', history)
    expect(query).toContain('Compare ECS and EKS.')
    expect(query).toContain('Current question: Which is cheaper?')
    expect(query).not.toContain('Private answer content')
    expect(query.length).toBeLessThanOrEqual(4000)
  })
  it('holds the entire draft until a second 120B provider approves it', async () => {
    let finish!: (value: ChatCompletionResponse) => void
    vi.mocked(sendCompletion).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const result = verifyAccuracyCompletion(
      draft(),
      thread,
      [{ role: 'user', content: 'Original question' }],
      providers,
      'cerebras',
      new AbortController().signal,
      evidence
    )
    let shown = false
    void result.then(() => {
      shown = true
    })
    await vi.waitFor(() => expect(sendCompletion).toHaveBeenCalledTimes(1))
    expect(shown).toBe(false)
    const args = vi.mocked(sendCompletion).mock.calls[0]
    expect(args[0].model).toEqual({
      id: 'openai/gpt-oss-120b',
      provider: 'groq',
    })
    expect(JSON.stringify(args[2])).toContain('Original question')
    expect(args[4]).toEqual([])
    finish(response({ verdict: 'approved' }))
    const checked = await result
    expect(await text(checked.completion)).toBe('Unverified draft')
    expect(checked.review?.verifier).toBe('groq 120B')
  })
  it('reviews a continued answer with its existing prefix exactly once', async () => {
    vi.mocked(sendCompletion).mockResolvedValue(
      response({ verdict: 'approved' })
    )
    const checked = await verifyAccuracyCompletion(
      draft(),
      thread,
      [],
      providers,
      'groq',
      new AbortController().signal,
      evidence,
      undefined,
      'Existing answer. '
    )
    expect(
      JSON.stringify(vi.mocked(sendCompletion).mock.calls[0][2])
    ).toContain('Existing answer. Unverified draft')
    expect(await text(checked.completion)).toBe(
      'Existing answer. Unverified draft'
    )
  })
  it('shows only the corrected answer and supplies web evidence to the reviewer', async () => {
    vi.mocked(sendCompletion).mockResolvedValue(
      response({ verdict: 'revised', answer: '- Corrected answer' })
    )
    const sources = [
      { url: 'https://docs.example.com', title: 'Docs', text: 'Evidence' },
    ]
    const checked = await verifyAccuracyCompletion(
      draft(),
      thread,
      [],
      providers,
      'groq',
      new AbortController().signal,
      Promise.resolve({ status: 'ready', sources })
    )
    expect(await text(checked.completion)).toBe('- Corrected answer')
    expect(
      JSON.stringify(vi.mocked(sendCompletion).mock.calls[0][2])
    ).toContain('Evidence')
    expect(checked.review?.sources[0].text).toBe('')
  })
  it('fails closed after both reviewers fail instead of exposing a draft', async () => {
    vi.mocked(sendCompletion).mockResolvedValue(
      response({ verdict: 'revised', answer: '' })
    )
    await expect(
      verifyAccuracyCompletion(
        draft(),
        thread,
        [],
        providers,
        'groq',
        new AbortController().signal,
        evidence
      )
    ).rejects.toThrow('No unchecked answer')
    expect(sendCompletion).toHaveBeenCalledTimes(2)
  })
  it('retains tool calls without displaying unreviewed answer text or calling a reviewer', async () => {
    const tools = (async function* () {
      yield {
        choices: [
          {
            delta: {
              content: 'Unverified text',
              tool_calls: [
                {
                  index: 0,
                  id: 'tool',
                  function: { name: 'search', arguments: '{}' },
                },
              ],
            },
          },
        ],
      }
    })() as ChatCompletionResponse
    const checked = await verifyAccuracyCompletion(
      tools,
      thread,
      [],
      providers,
      'groq',
      new AbortController().signal,
      evidence
    )
    const chunks = []
    for await (const chunk of checked.completion as AsyncIterable<any>)
      chunks.push(chunk)
    expect(chunks[0].choices[0].delta.content).toBeNull()
    expect(chunks[0].choices[0].delta.tool_calls[0].function.name).toBe(
      'search'
    )
    expect(sendCompletion).not.toHaveBeenCalled()
    expect(checked.review).toBeUndefined()
  })
  it('cancels a stuck reviewer without showing the draft or starting a fallback', async () => {
    vi.mocked(sendCompletion).mockImplementation(() => new Promise(() => {}))
    const controller = new AbortController()
    const result = verifyAccuracyCompletion(
      draft(),
      thread,
      [],
      providers,
      'groq',
      controller.signal,
      evidence
    )
    await vi.waitFor(() => expect(sendCompletion).toHaveBeenCalledTimes(1))
    controller.abort(new Error('Stopped'))
    await expect(result).rejects.toThrow('Stopped')
    expect(sendCompletion).toHaveBeenCalledTimes(1)
  })
  it('requires search and blocks memory-only answers when Exa is unconfigured or fails', async () => {
    for (const status of ['unconfigured', 'unavailable', 'empty'] as const) {
      await expect(
        verifyAccuracyCompletion(
          draft(),
          thread,
          [],
          providers,
          'groq',
          new AbortController().signal,
          Promise.resolve({ status, sources: [] })
        )
      ).rejects.toThrow('Accuracy requires')
    }
    expect(sendCompletion).not.toHaveBeenCalled()
  })
  it('bounds web search delays even when fetch ignores cancellation', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    )
    const result = getWebEvidence('Question', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(6000)
    expect(await result).toEqual({ status: 'unavailable', sources: [] })
  })
})
