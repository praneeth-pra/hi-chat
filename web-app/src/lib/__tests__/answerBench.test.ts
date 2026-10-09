import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  answerOnce,
  answerSummary,
  availableAnswerModels,
  compareAnswers,
  formatAnswers,
} from '../answerBench'

const sse = (lines: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(lines.map((l) => `data: ${l}\n\n`).join(''))
        )
        c.close()
      },
    }),
    { status: 200 }
  )

const cerebrasStream = () =>
  sse([
    JSON.stringify({ choices: [{ delta: { reasoning: 'thinking' } }] }),
    JSON.stringify({ choices: [{ delta: { content: 'Route ' } }] }),
    JSON.stringify({ choices: [{ delta: { content: 'tables.' } }] }),
    '[DONE]',
  ])

const claudeStream = () =>
  sse([
    JSON.stringify({
      type: 'message_start',
      message: { usage: { input_tokens: 5 } },
    }),
    JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'An IGW.' },
    }),
  ])

describe('answerBench', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('times the first word of the answer, not the thinking', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => cerebrasStream())
    )
    let t = 0
    const run = await answerOnce(
      { cerebras: { apiKey: 'k' }, instructions: 'Answer as P.' },
      'cerebras-120b',
      'How would you make a subnet public?',
      () => (t += 100)
    )
    expect(run.text).toBe('Route tables.')
    expect(run.firstMs).toBe(100)
    expect(run.error).toBeUndefined()
    const body = JSON.parse(
      (
        (fetch as unknown as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as RequestInit
      ).body as string
    )
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: 'Answer as P.',
    })
  })

  it('keeps going when a model fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 }))
    )
    const run = await answerOnce(
      { cerebras: { apiKey: 'k' } },
      'cerebras-120b',
      'Q?'
    )
    expect(run.error).toContain('Cerebras 401')
  })

  it('sends each Claude model its own id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => claudeStream())
    )
    await answerOnce({ anthropic: { apiKey: 'a' } }, 'claude-sonnet', 'Q?')
    const body = JSON.parse(
      (
        (fetch as unknown as ReturnType<typeof vi.fn>).mock
          .calls[0][1] as RequestInit
      ).body as string
    )
    expect(body.model).toBe('claude-sonnet-5-5')
  })

  it('asks both models each question and summarises', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('anthropic') ? claudeStream() : cerebrasStream()
      )
    )
    const config = { anthropic: { apiKey: 'a' }, cerebras: { apiKey: 'c' } }
    expect(availableAnswerModels(config)).toEqual([
      'claude-haiku',
      'claude-haiku-5',
      'claude-sonnet',
      'cerebras-120b',
    ])
    expect(availableAnswerModels({ cerebras: { apiKey: 'c' } })).toEqual([
      'cerebras-120b',
    ])
    const results: Parameters<typeof formatAnswers>[0] = []
    await compareAnswers(
      config,
      ['claude-haiku', 'cerebras-120b'],
      (r) => results.push(r),
      ['Q1?', 'Q2?']
    )
    expect(results).toHaveLength(2)
    expect(results[0].runs.map((r) => r.text)).toEqual([
      'An IGW.',
      'Route tables.',
    ])
    expect(answerSummary(results).map((s) => s.count)).toEqual([2, 2])
    expect(formatAnswers(results)).toContain('## 1. Q1?')
  })
})
