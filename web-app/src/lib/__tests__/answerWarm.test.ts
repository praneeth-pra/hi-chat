import { beforeEach, describe, expect, it, vi } from 'vitest'

const providers: { provider: string; api_key?: string; base_url?: string }[] =
  []
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: { getState: () => ({ providers }) },
}))

const okFetch = () =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(null))

describe('warmAnswer', () => {
  beforeEach(() => {
    vi.resetModules()
    providers.length = 0
    providers.push({
      provider: 'anthropic',
      api_key: 'sk-test',
      base_url: 'https://api.anthropic.com/v1',
    })
  })

  it('warms search and Claude with the real answer headers, and no prompt', async () => {
    const { warmAnswer } = await import('../answerWarm')
    const { useChatAuto } = await import('../chatModels')
    useChatAuto.setState({ auto: true, mode: 'accuracy' })
    const fetcher = okFetch()
    warmAnswer(fetcher as unknown as typeof fetch, 100_000)
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/search',
      'https://api.anthropic.com/v1/messages',
    ])
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
      warm: true,
    })
    const claude = fetcher.mock.calls[1][1]!
    expect(claude.body).toBe('{}')
    expect(claude.headers).toMatchObject({
      'x-api-key': 'sk-test',
      'anthropic-dangerous-direct-browser-access': 'true',
    })
  })

  it('throttles: search every 2 s, Claude every 20 s', async () => {
    const { warmAnswer } = await import('../answerWarm')
    const { useChatAuto } = await import('../chatModels')
    useChatAuto.setState({ auto: true, mode: 'accuracy' })
    const fetcher = okFetch()
    const f = fetcher as unknown as typeof fetch
    warmAnswer(f, 100_000)
    warmAnswer(f, 101_000)
    expect(fetcher).toHaveBeenCalledTimes(2)
    warmAnswer(f, 102_500)
    expect(fetcher.mock.calls.at(-1)![0]).toBe('/api/search')
    warmAnswer(f, 121_000)
    expect(fetcher.mock.calls.at(-1)![0]).toBe(
      'https://api.anthropic.com/v1/messages'
    )
  })

  it('does nothing outside Auto · Accuracy', async () => {
    const { warmAnswer } = await import('../answerWarm')
    const { useChatAuto } = await import('../chatModels')
    const fetcher = okFetch()
    useChatAuto.setState({ auto: true, mode: 'speed' })
    warmAnswer(fetcher as unknown as typeof fetch, 100_000)
    useChatAuto.setState({ auto: false, mode: 'accuracy' })
    warmAnswer(fetcher as unknown as typeof fetch, 200_000)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('skips Claude without an Anthropic key and survives a failed request', async () => {
    providers.length = 0
    const { warmAnswer } = await import('../answerWarm')
    const { useChatAuto } = await import('../chatModels')
    useChatAuto.setState({ auto: true, mode: 'accuracy' })
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    warmAnswer(fetcher as unknown as typeof fetch, 100_000)
    await Promise.resolve()
    expect(fetcher.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      '/api/search',
    ])
  })
})
