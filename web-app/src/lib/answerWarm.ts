import { useModelProvider } from '@/hooks/useModelProvider'
import { anthropicConfig } from '@/lib/anthropicProvider'
import { useChatAuto } from '@/lib/chatModels'

const CLAUDE_WARM_AGAIN_MS = 20_000
const SEARCH_WARM_AGAIN_MS = 2_000
let lastClaudeWarm = 0
let lastSearchWarm = 0

/**
 * Auto · Accuracy searches the web and then asks Claude, and after a quiet
 * spell both start cold: the browser re-opens its Claude connection and
 * re-asks Anthropic's permission (cached only 10 minutes), and the server
 * opens a fresh connection to the search provider. Called while you speak or
 * type, so the question itself skips that setup. No tokens are used: Claude
 * gets an empty request it rejects, and the search warm-up searches nothing.
 */
export function warmAnswer(fetcher: typeof fetch = fetch, now = Date.now()) {
  const { auto, mode } = useChatAuto.getState()
  if (!auto || mode !== 'accuracy') return
  if (now - lastSearchWarm >= SEARCH_WARM_AGAIN_MS) {
    lastSearchWarm = now
    fetcher('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ warm: true }),
    })
      .then((res) => res.body?.cancel())
      .catch(() => {})
  }
  if (now - lastClaudeWarm < CLAUDE_WARM_AGAIN_MS) return
  const { apiKey, baseUrl } = anthropicConfig(
    useModelProvider.getState().providers
  )
  if (!apiKey) return
  lastClaudeWarm = now
  const base = (baseUrl || 'https://api.anthropic.com')
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '')
  // Same URL and headers as the real answer, so the permission check is reused
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
    .then((res) => res.body?.cancel())
    .catch(() => {})
}
