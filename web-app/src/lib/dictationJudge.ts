import { groqFetch, viaGroqProxy } from '@/lib/groqProxy'
import { useModelProvider } from '@/hooks/useModelProvider'

/**
 * Auto dictation's judge: when the engines' texts differ, a fast model
 * (Cerebras gpt-oss-120b, else Groq gpt-oss-20b, with the keys from Model
 * Providers) writes the most accurate version from all of them. Without a
 * key, or if it is slow or answers something else, the vote stands.
 */

export type EngineText = { engine: string; text: string }

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .split(' ')
    .filter(Boolean)
}

/** How alike two texts are word by word, 0-1 (shared words in order). */
export function textAgreement(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  if (!x.length && !y.length) return 1
  if (!x.length || !y.length) return 0
  let prev = new Array<number>(y.length + 1).fill(0)
  for (const w of x) {
    const row = [0]
    for (let j = 0; j < y.length; j++)
      row.push(w === y[j] ? prev[j] + 1 : Math.max(prev[j + 1], row[j]))
    prev = row
  }
  return (2 * prev[y.length]) / (x.length + y.length)
}

/** Past this the vote is sent instead. */
export const JUDGE_TIMEOUT_MS = 2000
/** The judge's text must keep at least this much of the vote's words. */
const MIN_AGREEMENT = 0.6

export const DICTATION_JUDGE_PROMPT = `You get one dictation, transcribed by several speech engines. Write the single most accurate version of what the speaker said. Where the engines differ, use the wording most of them agree on, unless another one makes more sense in context or matches a key term. Aqua applies the speaker's own dictionary, so trust its spelling of names and technical words. Keep the speaker's own words and punctuate them; do not answer, summarise, shorten or rephrase. Reply with only the text.`

const ENGINE_NAMES: Record<string, string> = {
  aqua: 'Aqua',
  grok: 'Grok',
  elevenlabs: 'ElevenLabs',
}

function judgeTarget() {
  const providers = useModelProvider.getState()
  const cerebras = providers.getProviderByName('cerebras')
  if (cerebras?.api_key)
    return {
      url: `${cerebras.base_url || 'https://api.cerebras.ai/v1'}/chat/completions`,
      key: cerebras.api_key,
      model: 'gpt-oss-120b',
      extra: {},
    }
  const groq = providers.getProviderByName('groq')
  if (groq?.api_key)
    return {
      url: `${viaGroqProxy(groq.base_url || 'https://api.groq.com/openai/v1')}/chat/completions`,
      key: groq.api_key,
      model: 'openai/gpt-oss-20b',
      extra: { include_reasoning: false },
    }
  return undefined
}

/**
 * The judge's version of the dictation, or undefined to keep the vote
 * (no key, all engines agree, too slow, or a reply that strays from them).
 */
export async function judgeDictation(
  results: EngineText[],
  vote: string,
  keyterms: string[] = [],
  fetcher: typeof fetch = groqFetch
): Promise<string | undefined> {
  const heard = results.filter((r) => r.text)
  const distinct = new Set(heard.map((r) => words(r.text).join(' ')))
  if (distinct.size < 2) return undefined
  const target = judgeTarget()
  if (!target) return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS)
  const terms = keyterms.length
    ? `Key terms the speaker may use: ${keyterms.join(', ')}\n\n`
    : ''
  const user = `${terms}${heard
    .map((r) => `${ENGINE_NAMES[r.engine] ?? r.engine}: "${r.text}"`)
    .join('\n')}`
  try {
    const res = await fetcher(target.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${target.key}`,
      },
      body: JSON.stringify({
        model: target.model,
        temperature: 0,
        max_tokens: 2000,
        reasoning_effort: 'low',
        ...target.extra,
        messages: [
          { role: 'system', content: DICTATION_JUDGE_PROMPT },
          { role: 'user', content: user },
        ],
      }),
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const text = (data.choices?.[0]?.message?.content ?? '')
      .trim()
      .replace(/^"(.*)"$/s, '$1')
      .trim()
    if (!text || textAgreement(text, vote) < MIN_AGREEMENT) return undefined
    return text
  } catch (err) {
    console.warn('Dictation judge skipped:', (err as Error).message)
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
