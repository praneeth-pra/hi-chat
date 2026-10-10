import { describe, it, expect, vi } from 'vitest'
import { judgeDictation } from '../dictationJudge'

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

  it('skips the judge for one misheard word, sending the vote', async () => {
    const fetcher = reply('x')
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
    ).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
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
})
