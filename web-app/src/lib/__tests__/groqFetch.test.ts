import { describe, expect, it, vi } from 'vitest'
import { GROQ_PROXY_PATH, groqFetch, groqRoute } from '../groqProxy'

const proxied = `${window.location.origin}${GROQ_PROXY_PATH}/openai/v1/chat/completions`
const direct = 'https://api.groq.com/openai/v1/chat/completions'

/** A fetch whose replies are set per URL: a delay then a response, or a failure. */
function fakeFetch(plan: Record<string, { after: number; fail?: boolean }>) {
  const calls: string[] = []
  const aborted: string[] = []
  const impl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    const { after, fail } = plan[url]
    return new Promise<Response>((resolve, reject) => {
      const t = setTimeout(
        () =>
          fail ? reject(new Error('Load failed')) : resolve(new Response(url)),
        after
      )
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(t)
        aborted.push(url)
        reject(new Error('aborted'))
      })
    })
  }) as unknown as typeof fetch
  return { impl, calls, aborted }
}

describe('groqFetch', () => {
  it('uses the direct route when Groq answers quickly', async () => {
    const f = fakeFetch({ [direct]: { after: 5 }, [proxied]: { after: 5 } })
    const res = await groqFetch(proxied, { method: 'POST' }, f.impl, 50)
    expect(await res.text()).toBe(direct)
    expect(groqRoute(res)).toBe('direct')
    expect(f.calls).toEqual([direct])
  })

  it('adds the server route when the direct one is slow, and keeps the first reply', async () => {
    const f = fakeFetch({ [direct]: { after: 500 }, [proxied]: { after: 5 } })
    const res = await groqFetch(proxied, { method: 'POST' }, f.impl, 20)
    expect(groqRoute(res)).toBe('server')
    expect(f.calls).toEqual([direct, proxied])
    expect(f.aborted).toEqual([direct])
  })

  it('goes through the server at once when the direct route fails', async () => {
    const f = fakeFetch({
      [direct]: { after: 1, fail: true },
      [proxied]: { after: 5 },
    })
    const res = await groqFetch(proxied, { method: 'POST' }, f.impl, 1000)
    expect(groqRoute(res)).toBe('server')
  })

  it('fails only when both routes fail', async () => {
    const f = fakeFetch({
      [direct]: { after: 1, fail: true },
      [proxied]: { after: 1, fail: true },
    })
    await expect(
      groqFetch(proxied, { method: 'POST' }, f.impl, 1000)
    ).rejects.toThrow('Load failed')
  })

  it('cancels both routes when the caller stops', async () => {
    const f = fakeFetch({ [direct]: { after: 500 }, [proxied]: { after: 500 } })
    const stop = new AbortController()
    const pending = groqFetch(proxied, { signal: stop.signal }, f.impl, 10)
    await new Promise((r) => setTimeout(r, 30))
    stop.abort()
    await expect(pending).rejects.toThrow('aborted')
    expect(f.aborted.sort()).toEqual([direct, proxied].sort())
  })

  it('leaves other URLs alone', async () => {
    const other = 'https://api.cerebras.ai/v1/chat/completions'
    const f = fakeFetch({ [other]: { after: 1 } })
    await groqFetch(other, {}, f.impl)
    expect(f.calls).toEqual([other])
  })
})
