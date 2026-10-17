import { beforeEach, describe, expect, it, vi } from 'vitest'

const store: {
  selectedProvider: string
  providers: { provider: string; api_key?: string; base_url?: string }[]
} = { selectedProvider: 'groq', providers: [] }
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: { getState: () => store },
}))

const okFetch = () =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(null))
const urls = (f: ReturnType<typeof okFetch>) => f.mock.calls.map(([u]) => u)

const load = async (auto: boolean, mode: 'speed' | 'accuracy') => {
  const { warmAnswer } = await import('../answerWarm')
  const { useChatAuto } = await import('../chatModels')
  useChatAuto.setState({ auto, mode })
  return warmAnswer
}

describe('warmAnswer', () => {
  beforeEach(() => {
    vi.resetModules()
    store.selectedProvider = 'groq'
    store.providers = [
      {
        provider: 'anthropic',
        api_key: 'sk-ant',
        base_url: 'https://api.anthropic.com/v1',
      },
      {
        provider: 'groq',
        api_key: 'gsk',
        base_url: 'https://api.groq.com/openai/v1',
      },
      {
        provider: 'cerebras',
        api_key: 'csk',
        base_url: 'https://api.cerebras.ai/v1',
      },
      { provider: 'llamacpp', api_key: 'x', base_url: 'http://localhost:1' },
    ]
  })

  it('a picked model: warms its service with the chat library headers, no prompt', async () => {
    const warmAnswer = await load(false, 'speed')
    const fetcher = okFetch()
    warmAnswer({}, fetcher as unknown as typeof fetch, 100_000)
    expect(urls(fetcher)).toEqual([
      'https://api.groq.com/openai/v1/chat/completions',
    ])
    const init = fetcher.mock.calls[0][1]!
    expect(init.body).toBe('{}')
    expect(init.headers).toMatchObject({
      'authorization': 'Bearer gsk',
      'x-stainless-retry-count': '0',
    })
  })

  it('a picked Claude model warms Claude with the answer headers', async () => {
    store.selectedProvider = 'anthropic'
    const warmAnswer = await load(false, 'speed')
    const fetcher = okFetch()
    warmAnswer({}, fetcher as unknown as typeof fetch, 100_000)
    expect(urls(fetcher)).toEqual(['https://api.anthropic.com/v1/messages'])
    expect(fetcher.mock.calls[0][1]!.headers).toMatchObject({
      'x-api-key': 'sk-ant',
      'anthropic-dangerous-direct-browser-access': 'true',
    })
  })

  it('skips local models', async () => {
    store.selectedProvider = 'llamacpp'
    const warmAnswer = await load(false, 'speed')
    const fetcher = okFetch()
    warmAnswer({}, fetcher as unknown as typeof fetch, 100_000)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('Auto · Speed warms Cerebras and Groq once each', async () => {
    const warmAnswer = await load(true, 'speed')
    const fetcher = okFetch()
    warmAnswer({}, fetcher as unknown as typeof fetch, 100_000)
    expect(urls(fetcher)).toEqual([
      'https://api.cerebras.ai/v1/chat/completions',
      'https://api.groq.com/openai/v1/chat/completions',
    ])
  })

  it('Auto · Accuracy warms search and Claude', async () => {
    const warmAnswer = await load(true, 'accuracy')
    const fetcher = okFetch()
    warmAnswer({}, fetcher as unknown as typeof fetch, 100_000)
    expect(urls(fetcher)).toEqual([
      '/api/search',
      'https://api.anthropic.com/v1/messages',
    ])
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
      warm: true,
    })
  })

  it('throttles typing to every 8 s, but warms again right before sending', async () => {
    const warmAnswer = await load(false, 'speed')
    const fetcher = okFetch()
    const f = fetcher as unknown as typeof fetch
    warmAnswer({}, f, 100_000)
    warmAnswer({}, f, 105_000)
    expect(fetcher).toHaveBeenCalledTimes(1)
    warmAnswer({ soon: true }, f, 106_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    warmAnswer({}, f, 114_500)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('never throws, even when the stores or network fail', async () => {
    const warmAnswer = await load(false, 'speed')
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(() =>
      warmAnswer({}, fetcher as unknown as typeof fetch, 100_000)
    ).not.toThrow()
    store.providers = undefined as unknown as typeof store.providers
    expect(() =>
      warmAnswer({}, fetcher as unknown as typeof fetch, 200_000)
    ).not.toThrow()
    await Promise.resolve()
  })
})
