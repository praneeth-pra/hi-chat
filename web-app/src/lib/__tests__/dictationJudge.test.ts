import { describe, it, expect, vi } from 'vitest'
import {
  getDictationJudges,
  judgeDictation,
  setDictationJudges,
  warmJudges,
} from '../dictationJudge'

const providers: Record<string, { api_key?: string; base_url?: string }> = {
  cerebras: { api_key: 'csk' },
}
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      getProviderByName: (name: string) => providers[name],
    }),
  },
}))

const reply = (content: string) =>
  vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }))
  )

const results = [
  { engine: 'cartesia', text: 'Run kube cuddle get pods' },
  { engine: 'grok', text: 'Run cube cuddle get pods.' },
  { engine: 'elevenlabs', text: 'Run kubectl get pods.' },
]

describe('judgeDictation', () => {
  it('asks Cerebras with every engine text and the key terms', async () => {
    const fetcher = reply('"Run kubectl get pods."')
    const text = await judgeDictation(
      results,
      'Run kubectl get pods.',
      ['kubectl'],
      fetcher as unknown as typeof fetch
    )
    expect(text).toBe('Run kubectl get pods.')
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('https://api.cerebras.ai/v1/chat/completions')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gpt-oss-120b')
    expect(body.messages[1].content).toContain(
      'Key terms the speaker may use: kubectl'
    )
    expect(body.messages[1].content).toContain(
      'Grok: "Run cube cuddle get pods."'
    )
  })

  it('keeps the vote when the engines agree, or the reply strays', async () => {
    const fetcher = reply('Sure! Here is how to list pods in Kubernetes.')
    const same = results.map((r) => ({ ...r, text: 'Run kubectl get pods' }))
    expect(
      await judgeDictation(same, 'x', [], fetcher as unknown as typeof fetch)
    ).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
    expect(
      await judgeDictation(
        results,
        'Run kubectl get pods.',
        [],
        fetcher as unknown as typeof fetch
      )
    ).toBeUndefined()
  })

  it('skips the judge when the texts are a comma apart', async () => {
    const fetcher = reply('x')
    const near = [
      {
        engine: 'cartesia',
        text: 'Okay, so did you face any issues in your past?',
      },
      {
        engine: 'elevenlabs',
        text: 'Okay so did you face any issues in your past?',
      },
    ]
    expect(
      await judgeDictation(
        near,
        near[0].text,
        [],
        fetcher as unknown as typeof fetch
      )
    ).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('asks the judge about one misheard word when only two engines heard it', async () => {
    const fetcher = reply(
      "S3 bucket. And if it's a cross-account, then you also have to mention inside the bucket policies that this is"
    )
    const close = [
      {
        engine: 'cartesia',
        text: "S3 bucket. And if it's a cross-account, then you also have to mention inside the bucket policies that this is",
      },
      {
        engine: 'elevenlabs',
        text: "... Extra bucket, and if it's a cross-account, then you also have to mention inside the bucket policies that this is-",
      },
    ]
    expect(
      await judgeDictation(
        close,
        close[0].text,
        [],
        fetcher as unknown as typeof fetch
      )
    ).toContain('S3 bucket')
    expect(fetcher).toHaveBeenCalled()
  })

  it('falls back to Groq, and to the vote with no key', async () => {
    delete providers.cerebras
    providers.groq = { api_key: 'gsk' }
    const fetcher = reply('Run kubectl get pods.')
    await judgeDictation(
      results,
      'Run kubectl get pods.',
      [],
      fetcher as unknown as typeof fetch
    )
    const body = JSON.parse(fetcher.mock.calls[0][1].body as string)
    expect(body.model).toBe('openai/gpt-oss-20b')
    delete providers.groq
    expect(
      await judgeDictation(results, 'v', [], fetcher as unknown as typeof fetch)
    ).toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('skips the judge when two of three engines agree', async () => {
    providers.cerebras = { api_key: 'csk' }
    const fetcher = vi.fn()
    const rest =
      'so the attached IP is going to be changed with respect to that'
    expect(
      await judgeDictation(
        [
          { engine: 'cartesia', text: `system is restarted newly. So ${rest}` },
          { engine: 'soniox', text: `The system is restart newly, ${rest}.` },
          {
            engine: 'elevenlabs',
            text: `The system is restarted newly, ${rest}.`,
          },
        ],
        `The system is restarted newly, ${rest}.`,
        [],
        fetcher as unknown as typeof fetch
      )
    ).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('asks Cerebras and Groq at once and uses the first usable reply', async () => {
    providers.cerebras = { api_key: 'csk' }
    providers.groq = { api_key: 'gsk' }
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn((url: string, init: RequestInit) =>
        url.includes('cerebras')
          ? new Promise<Response>((_, reject) =>
              init.signal?.addEventListener('abort', () =>
                reject(new Error('aborted'))
              )
            )
          : Promise.resolve(
              new Response(
                JSON.stringify({
                  choices: [{ message: { content: 'Run kubectl get pods.' } }],
                })
              )
            )
      )
      const judged = judgeDictation(
        results,
        'Run kubectl get pods.',
        [],
        fetcher as unknown as typeof fetch
      )
      expect(fetcher).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(0)
      await expect(judged).resolves.toBe('Run kubectl get pods.')
      expect(fetcher).toHaveBeenCalledTimes(2)
      // The slow Cerebras request is cancelled
      expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(
        true
      )
    } finally {
      vi.useRealTimers()
      delete providers.groq
    }
  })

  it('uses Groq when Cerebras fails, and keeps the vote if both fail', async () => {
    providers.cerebras = { api_key: 'csk' }
    providers.groq = { api_key: 'gsk' }
    try {
      const fetcher = vi.fn(async (url: string) =>
        url.includes('cerebras')
          ? new Response('busy', { status: 503 })
          : new Response(
              JSON.stringify({
                choices: [{ message: { content: 'Run kubectl get pods.' } }],
              })
            )
      )
      const started = Date.now()
      await expect(
        judgeDictation(
          results,
          'Run kubectl get pods.',
          [],
          fetcher as unknown as typeof fetch
        )
      ).resolves.toBe('Run kubectl get pods.')
      expect(Date.now() - started).toBeLessThan(300)
      const down = vi.fn(async () => new Response('busy', { status: 503 }))
      await expect(
        judgeDictation(results, 'v', [], down as unknown as typeof fetch)
      ).resolves.toBeUndefined()
      expect(down).toHaveBeenCalledTimes(2)
    } finally {
      delete providers.groq
    }
  })

  it('uses only the judges chosen in Settings', async () => {
    providers.groq = { api_key: 'gsk' }
    try {
      expect(getDictationJudges()).toEqual(['cerebras-120b', 'groq-20b'])
      setDictationJudges(['cerebras-qwen', 'groq-120b'])
      const fetcher = reply('Run kubectl get pods.')
      await judgeDictation(
        results,
        'Run kubectl get pods.',
        [],
        fetcher as unknown as typeof fetch
      )
      const bodies = fetcher.mock.calls.map((c) =>
        JSON.parse(String((c[1] as RequestInit).body))
      )
      expect(bodies.map((b) => b.model).sort()).toEqual([
        'openai/gpt-oss-120b',
        'qwen-3.8-27b',
      ])
      expect(
        bodies.find((b) => b.model === 'qwen-3.8-27b').reasoning_effort
      ).toBe('none')
      // None chosen: the vote stands, nothing is asked
      setDictationJudges([])
      const none = reply('x')
      expect(
        await judgeDictation(results, 'v', [], none as unknown as typeof fetch)
      ).toBeUndefined()
      expect(none).not.toHaveBeenCalled()
    } finally {
      localStorage.removeItem('dictation-judges')
      delete providers.groq
    }
  })
})

describe('warmJudges', () => {
  it('opens each chosen judge connection once, direct to Groq, then rests', async () => {
    providers.groq = { api_key: 'gsk' }
    setDictationJudges(['cerebras-120b', 'groq-20b', 'groq-120b'])
    const fetcher = vi.fn(async () => new Response('{}'))
    warmJudges(fetcher as unknown as typeof fetch, 1_000_000)
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
      'https://api.cerebras.ai/v1/models',
      'https://api.groq.com/openai/v1/models',
    ])
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer csk' },
    })
    warmJudges(fetcher as unknown as typeof fetch, 1_010_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    warmJudges(fetcher as unknown as typeof fetch, 1_030_000)
    expect(fetcher).toHaveBeenCalledTimes(4)
    delete providers.groq
    setDictationJudges(['cerebras-120b', 'groq-20b'])
  })
})
