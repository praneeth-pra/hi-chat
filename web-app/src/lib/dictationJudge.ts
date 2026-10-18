import { groqFetch, viaGroqProxy } from '@/lib/groqProxy'
import { useModelProvider } from '@/hooks/useModelProvider'

/**
 * Auto dictation's judge: when the engines' texts differ, the fast models
 * chosen in Settings (Cerebras gpt-oss-120b and Groq gpt-oss-20b by default,
 * with the keys from Model Providers) race to write the most accurate
 * version from all of them. Without a key, or if they are slow or answer
 * something else, the vote stands.
 */

export type EngineText = { engine: string; text: string }

/** Filler words, ignored when comparing (some engines write them out). */
const FILLERS = new Set(['uh', 'um', 'uhm', 'umm', 'erm', 'hmm', 'mm', 'like'])

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .split(' ')
    .filter((w) => w && !FILLERS.has(w))
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
export const JUDGE_TIMEOUT_MS = 1500
/**
 * With three or more engines, texts this alike skip the judge and the vote
 * (the text the others agree with most) is sent. On P's questions, "Okay,
 * so ... issue like" vs "So ... issue," scored 0.97 and "S3 bucket" vs
 * "Extra bucket" 0.95; a real mix-up scored 0.89.
 */
export const SKIP_AGREEMENT = 0.93
/** The judge's text must keep at least this much of the vote's words. */
const MIN_AGREEMENT = 0.6

export const DICTATION_JUDGE_PROMPT = `You get one dictation, transcribed by several speech engines. Write the single most accurate version of what the speaker said. Where the engines differ, use the wording most of them agree on, unless another one makes more sense in context or matches a key term. Soniox and Cartesia are given the speaker's own dictionary, so trust their spelling of names and technical words. Only use words at least one engine heard: a key term can decide between the engines' versions, but never put in a word none of them heard. Leave out filler words such as uh and um. Keep the speaker's own words and punctuate them; do not answer, summarise, shorten or rephrase. Reply with only the text.`

const ENGINE_NAMES: Record<string, string> = {
  grok: 'Grok',
  muse: 'Muse',
  elevenlabs: 'ElevenLabs',
  soniox: 'Soniox',
  cartesia: 'Cartesia',
}

export type DictationJudge =
  | 'cerebras-120b'
  | 'cerebras-qwen'
  | 'groq-20b'
  | 'groq-120b'

/** Judge models to pick from in Settings; the chosen ones all run at once. */
export const DICTATION_JUDGES: {
  value: DictationJudge
  label: string
  provider: 'cerebras' | 'groq'
  model: string
  extra: Record<string, unknown>
}[] = [
  {
    value: 'cerebras-120b',
    label: 'Cerebras gpt-oss-120b',
    provider: 'cerebras',
    model: 'gpt-oss-120b',
    extra: {},
  },
  {
    value: 'cerebras-qwen',
    label: 'Cerebras Qwen 3.8 27B (no thinking)',
    provider: 'cerebras',
    model: 'qwen-3.8-27b',
    extra: { reasoning_effort: 'none' },
  },
  {
    value: 'groq-20b',
    label: 'Groq gpt-oss-20b',
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    extra: { include_reasoning: false },
  },
  {
    value: 'groq-120b',
    label: 'Groq gpt-oss-120b',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    extra: { include_reasoning: false },
  },
]
const DEFAULT_JUDGES: DictationJudge[] = ['cerebras-120b', 'groq-20b']
const JUDGES_STORAGE_KEY = 'dictation-judges'

/** The judges chosen in Settings (none means the vote is always sent). */
export function getDictationJudges(): DictationJudge[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(JUDGES_STORAGE_KEY) ?? 'null'
    )
    if (Array.isArray(saved))
      return DICTATION_JUDGES.map((j) => j.value).filter((v) =>
        saved.includes(v)
      )
  } catch {
    // Storage blocked or unreadable
  }
  return DEFAULT_JUDGES
}

export function setDictationJudges(judges: DictationJudge[]) {
  try {
    localStorage.setItem(JUDGES_STORAGE_KEY, JSON.stringify(judges))
  } catch {
    // Storage blocked
  }
}

function judgeTargets(direct = false) {
  const providers = useModelProvider.getState()
  const chosen = getDictationJudges()
  return DICTATION_JUDGES.filter((j) => chosen.includes(j.value)).flatMap(
    (judge) => {
      const provider = providers.getProviderByName(judge.provider)
      if (!provider?.api_key) return []
      const own =
        provider.base_url ||
        (judge.provider === 'cerebras'
          ? 'https://api.cerebras.ai/v1'
          : 'https://api.groq.com/openai/v1')
      const base =
        judge.provider === 'cerebras' || direct ? own : viaGroqProxy(own)
      return [
        {
          base,
          url: `${base}/chat/completions`,
          key: provider.api_key,
          model: judge.model,
          extra: judge.extra,
        },
      ]
    }
  )
}

const WARM_AGAIN_MS = 20_000
let lastWarm = 0

/**
 * Opens the connections to the chosen judges while you are still speaking,
 * so the judge request after you stop skips the connection setup (about
 * 0.1-0.2 s when it has gone cold). A cheap model list request, no tokens;
 * Groq is warmed on its direct route, which groqFetch tries first.
 */
export function warmJudges(fetcher: typeof fetch = fetch, now = Date.now()) {
  if (now - lastWarm < WARM_AGAIN_MS) return
  const targets = judgeTargets(true)
  if (!targets.length) return
  lastWarm = now
  const bases = new Map(targets.map((t) => [t.base, t.key]))
  bases.forEach((key, base) => {
    fetcher(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    })
      .then((res) => res.body?.cancel())
      .catch(() => {})
  })
}

/**
 * Sends one prompt to every judge at once and returns the first reply
 * `accept` takes. Groq used to wait 0.6 s for Cerebras, but on 14 Oct
 * Cerebras's judging took 0.72 s on a typical clip and up to 1.13 s.
 */
async function askJudge(
  system: string,
  user: string,
  fetcher: typeof fetch,
  timeoutMs: number,
  accept: (text: string) => boolean = (text) => !!text
): Promise<string | undefined> {
  const targets = judgeTargets()
  if (!targets.length) return undefined
  const controller = new AbortController()
  const timers: ReturnType<typeof setTimeout>[] = []
  try {
    return await new Promise<string | undefined>((resolve) => {
      let pending = 0
      let started = 0
      const ask = async (target: (typeof targets)[number]) => {
        started++
        pending++
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
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
            }),
          })
          if (!res.ok) throw new Error(`status ${res.status}`)
          const data = (await res.json()) as {
            choices?: { message?: { content?: string } }[]
          }
          const text = (data.choices?.[0]?.message?.content ?? '').trim()
          if (accept(text)) return resolve(text)
          throw new Error('reply not usable')
        } catch (err) {
          if (!controller.signal.aborted)
            console.warn(
              `Dictation judge (${target.model}) skipped:`,
              (err as Error).message
            )
        } finally {
          if (--pending === 0 && started === targets.length) resolve(undefined)
        }
      }
      targets.forEach((target) => void ask(target))
      timers.push(setTimeout(() => resolve(undefined), timeoutMs))
    })
  } finally {
    timers.forEach(clearTimeout)
    controller.abort()
  }
}

/**
 * Nothing to judge when two engines (nearly) agree and a third can outvote a
 * word one of them misheard. With only two texts, any word they differ on
 * goes to the judge: there is no third to break the tie.
 */
export function enginesAgree(results: EngineText[]): boolean {
  const heard = results.filter((r) => r.text)
  const enough = heard.length > 2 ? SKIP_AGREEMENT : 1
  return (
    heard.length < 2 ||
    heard.some((a, i) =>
      heard.slice(i + 1).some((b) => textAgreement(a.text, b.text) >= enough)
    )
  )
}

const keytermLine = (keyterms: string[]) =>
  keyterms.length
    ? `Key terms the speaker may use: ${keyterms.join(', ')}\n\n`
    : ''

/**
 * The judge's version of the dictation, or undefined to keep the vote
 * (no key, two engines agree, too slow, or a reply that strays from them).
 */
export async function judgeDictation(
  results: EngineText[],
  vote: string,
  keyterms: string[] = [],
  fetcher: typeof fetch = groqFetch,
  timeoutMs = JUDGE_TIMEOUT_MS
): Promise<string | undefined> {
  if (enginesAgree(results)) return undefined
  const user = `${keytermLine(keyterms)}${results
    .filter((r) => r.text)
    .map((r) => `${ENGINE_NAMES[r.engine] ?? r.engine}: "${r.text}"`)
    .join('\n')}`
  const clean = (reply: string) => reply.replace(/^"(.*)"$/s, '$1').trim()
  const reply = await askJudge(
    DICTATION_JUDGE_PROMPT,
    user,
    fetcher,
    timeoutMs,
    (reply) =>
      !!clean(reply) && textAgreement(clean(reply), vote) >= MIN_AGREEMENT
  )
  return reply === undefined ? undefined : clean(reply)
}
