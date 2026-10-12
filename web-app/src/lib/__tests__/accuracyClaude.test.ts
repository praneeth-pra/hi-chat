import { afterEach, describe, expect, it, vi } from 'vitest'
import { claudeAccuracyAnswer } from '../accuracyClaude'
import type { WebEvidence } from '../accuracyReview'

const evidence: WebEvidence = {
  status: 'ready',
  searchMs: 700,
  sources: [{ url: 'https://docs.example.com', title: 'Docs', text: 'Body' }],
}
const sse = (...texts: string[]) =>
  new Response(
    [
      { type: 'message_start', message: { usage: { input_tokens: 5 } } },
      ...texts.map((text) => ({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text },
      })),
      { type: 'message_delta', usage: { output_tokens: 3 } },
      { type: 'message_stop' },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('')
  )
const run = (signal = new AbortController().signal, firstTokenMs?: number) => {
  const onDone = vi.fn()
  return {
    onDone,
    result: claudeAccuracyAnswer({
      apiKey: 'sk-ant',
      messages: [
        { role: 'system', content: 'Use the sources.' },
        { role: 'user', content: 'What is DNS?' },
      ],
      evidence,
      signal,
      requestStart: Date.now(),
      onDone,
      firstTokenMs,
    }),
  }
}
const text = async (stream: AsyncIterable<any>) => {
  let out = ''
  for await (const chunk of stream) out += chunk.choices[0].delta.content ?? ''
  return out
}

describe('Claude Accuracy answer', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  it('streams Claude Sonnet 5.5 with thinking off and low effort, then reports the answer time', async () => {
    const fetchMock = vi.fn(async () => sse('DNS maps ', 'names [1].'))
    vi.stubGlobal('fetch', fetchMock)
    const { result, onDone } = run()
    const { completion, review } = await result
    expect(review).toMatchObject({
      verdict: 'direct',
      verifier: 'Claude Sonnet 5.5',
      model: 'claude-sonnet-5-5',
      webStatus: 'ready',
      searchMs: 700,
      firstTokenMs: expect.any(Number),
    })
    expect(review.sources).toEqual([
      { url: 'https://docs.example.com', title: 'Docs', text: '' },
    ])
    expect(onDone).not.toHaveBeenCalled()
    expect(await text(completion)).toBe('DNS maps names [1].')
    expect(onDone).toHaveBeenCalledWith(review)
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body)
    expect(body).toMatchObject({
      model: 'claude-sonnet-5-5',
      stream: true,
      system: 'Use the sources.',
      thinking: { type: 'between_tools' },
      output_config: { effort: 'low' },
    })
  })
  it('throws on a Claude error so Accuracy can fall back to gpt-oss', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('overloaded', { status: 529 }))
    )
    await expect(run().result).rejects.toThrow('Claude 529')
  })
  it('gives up when no words arrive in time and cancels the request', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined
        return new Promise(() => {})
      })
    )
    await expect(run(undefined, 50).result).rejects.toThrow(
      'Claude answer timed out'
    )
    expect(signal?.aborted).toBe(true)
  })
  it('rejects with the stop reason when the user stops first', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason)
            )
          )
      )
    )
    const controller = new AbortController()
    const { result } = run(controller.signal)
    controller.abort(new Error('Stopped'))
    await expect(result).rejects.toThrow('Stopped')
  })
})
