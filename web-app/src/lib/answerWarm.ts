import { useModelProvider } from '@/hooks/useModelProvider'
import { anthropicConfig } from '@/lib/anthropicProvider'
import { autoChain, useChatAuto } from '@/lib/chatModels'

/** Anthropic keeps its permission answer 10 minutes; the connection less. */
const CLAUDE_WARM_AGAIN_MS = 20_000
/**
 * Groq and Cerebras don't say how long to keep theirs, so browsers keep it
 * about 5 s: warm just before sending (dictation stop) and now and then while
 * typing, without spending much of the key's request allowance.
 */
const CHAT_WARM_AGAIN_MS = 8_000
const CHAT_WARM_SOON_MS = 1_000
const SEARCH_WARM_AGAIN_MS = 2_000
const lastWarm = new Map<string, number>()

/**
 * Header names the chat library sends; the browser reuses a permission answer
 * only when the real request asks for no header the warm-up didn't.
 */
const CHAT_HEADERS = {
  'content-type': 'application/json',
  'x-stainless-arch': 'unknown',
  'x-stainless-lang': 'js',
  'x-stainless-os': 'Unknown',
  'x-stainless-package-version': '0',
  'x-stainless-retry-count': '0',
  'x-stainless-runtime': 'browser:safari',
  'x-stainless-runtime-version': '0',
  'x-stainless-timeout': '600',
}

const due = (key: string, every: number, now: number) => {
  if (now - (lastWarm.get(key) ?? -Infinity) < every) return false
  lastWarm.set(key, now)
  return true
}

const discard = (request: Promise<Response>) =>
  request.then((res) => res.body?.cancel()).catch(() => {})

/**
 * After a quiet spell the next answer starts cold: the browser re-opens its
 * connection to the model's service and asks it again for permission to call
 * it from this site, a round trip each before the question even leaves (and
 * in Accuracy the server reconnects to the search provider too). Called while
 * you speak or type, so the question skips that setup. Uses no tokens: each
 * service gets an empty request it rejects, and the search warm-up searches
 * nothing. `soon` means the question goes out in a moment (dictation stop).
 */
export function warmAnswer(
  { soon = false }: { soon?: boolean } = {},
  fetcher: typeof fetch = fetch,
  now = Date.now()
) {
  // Only a head start: it must never get in the way of typing or dictation
  try {
    warm(soon, fetcher, now)
  } catch {
    // The question opens its own connections
  }
}

function warm(soon: boolean, fetcher: typeof fetch, now: number) {
  const { auto, mode } = useChatAuto.getState()
  const state = useModelProvider.getState()
  const withKey = (name: string) =>
    state.providers.find((p) => p.provider === name && !!p.api_key)

  // Accuracy always searches and a hand-picked model searches for fresh facts
  // (latest versions, prices, news); Auto · Speed never searches
  if (
    (!auto || mode === 'accuracy') &&
    due('search', SEARCH_WARM_AGAIN_MS, now)
  )
    discard(
      fetcher('/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ warm: true }),
      })
    )
  if (auto && mode === 'accuracy') {
    warmClaude(anthropicConfig(state.providers), fetcher, now)
    return
  }
  const chatTargets = auto
    ? autoChain().map((c) => withKey(c.provider))
    : [withKey(state.selectedProvider)]
  for (const provider of new Set(chatTargets)) {
    if (!provider?.api_key || !provider.base_url) continue
    if (provider.provider === 'anthropic') {
      warmClaude(
        { apiKey: provider.api_key, baseUrl: provider.base_url },
        fetcher,
        now
      )
      continue
    }
    const base = provider.base_url.replace(/\/+$/, '')
    if (!base.startsWith('https://')) continue
    if (!due(base, soon ? CHAT_WARM_SOON_MS : CHAT_WARM_AGAIN_MS, now)) continue
    discard(
      fetcher(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          ...CHAT_HEADERS,
          authorization: `Bearer ${provider.api_key}`,
        },
        body: '{}',
      })
    )
  }
}

function warmClaude(
  { apiKey, baseUrl }: { apiKey?: string; baseUrl?: string },
  fetcher: typeof fetch,
  now: number
) {
  if (!apiKey) return
  const base = (baseUrl || 'https://api.anthropic.com')
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '')
  if (!due(base, CLAUDE_WARM_AGAIN_MS, now)) return
  // Same URL and headers as the real answer, so the permission check is reused
  discard(
    fetcher(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: '{}',
    })
  )
}
