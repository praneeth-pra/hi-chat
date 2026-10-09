import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamClaude, toClaudeMessages } from '../claudeChat'

describe('toClaudeMessages', () => {
  it('moves system text out and merges turns so they alternate from the user', () => {
    expect(
      toClaudeMessages([
        { role: 'system', content: 'You are P.' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'What is a VPC?' },
        { role: 'user', content: [{ type: 'text', text: 'And subnets?' }] },
        { role: 'tool', content: 'ignored' },
        { role: 'assistant', content: '' },
      ])
    ).toEqual({
      system: 'You are P.',
      messages: [{ role: 'user', content: 'What is a VPC?\n\nAnd subnets?' }],
    })
  })
})

describe('streamClaude', () => {
  afterEach(() => vi.unstubAllGlobals())

  const sse = (events: object[]) =>
    new Response(
      new ReadableStream({
        start(c) {
          const enc = new TextEncoder()
          // Split mid-line to check buffering
          const text = events
            .map((e) => `data: ${JSON.stringify(e)}\n\n`)
            .join('')
          c.enqueue(enc.encode(text.slice(0, 40)))
          c.enqueue(enc.encode(text.slice(40)))
          c.close()
        },
      }),
      { status: 200 }
    )

  it('turns text deltas into OpenAI-style chunks', async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        { type: 'message_start', message: { usage: { input_tokens: 10 } } },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'A VPC ' },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'is…' },
        },
        { type: 'message_delta', usage: { output_tokens: 4 } },
      ])
    )
    vi.stubGlobal('fetch', fetchMock)
    const stream = await streamClaude({
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'What is a VPC?' }],
      signal: new AbortController().signal,
    })
    const text: string[] = []
    let usage
    for await (const c of stream) {
      text.push(c.choices[0].delta.content ?? '')
      usage = c.usage ?? usage
    }
    expect(text.join('')).toBe('A VPC is…')
    expect(usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 4,
      total_tokens: 14,
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'claude-haiku-4-5',
      stream: true,
    })
  })

  it('throws on an error response so the fallback takes over', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('overloaded', { status: 529 }))
    )
    await expect(
      streamClaude({
        apiKey: 'k',
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'Hi' }],
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('Claude 529')
  })
})
