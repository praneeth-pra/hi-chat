import { groqFetch, viaGroqProxy } from '@/lib/groqProxy'
import { useModelProvider } from '@/hooks/useModelProvider'

/**
 * Auto dictation's judge: when the engines' texts differ, a fast model
 * (Cerebras gpt-oss-120b, else Groq gpt-oss-20b, with the keys from Model
 * Providers) writes the most accurate version from all of them. Without a
 * key, or if it is slow or answers something else, the vote stands.
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
 * Groq's judge joins if Cerebras hasn't answered by now. In the 12 Oct mock
 * interview Cerebras judged in 0.37-1.04 s but twice ran past the timeout.
 */
export const JUDGE_HEDGE_MS = 600
/**
 * Texts this alike skip the judge and the vote is sent. On P's questions,
 * "Okay, so ... issue like" vs "So ... issue," scored 0.97 and "S3 bucket"
 * vs "Extra bucket" 0.95 (the first engine right both times); a real mix-up
 * scored 0.89.
 */
export const SKIP_AGREEMENT = 0.93
/** The judge's text must keep at least this much of the vote's words. */
const MIN_AGREEMENT = 0.6

export const DICTATION_JUDGE_PROMPT = `You get one dictation, transcribed by several speech engines. Write the single most accurate version of what the speaker said. Where the engines differ, use the wording most of them agree on, unless another one makes more sense in context or matches a key term. Soniox and Cartesia are given the speaker's own dictionary, so trust their spelling of names and technical words. Only use words at least one engine heard: a key term can decide between the engines' versions, but never put in a word none of them heard. Leave out filler words such as uh and um. Keep the speaker's own words and punctuate them; do not answer, summarise, shorten or rephrase. Reply with only the text.`

const ENGINE_NAMES: Record<string, string> = {
  grok: 'Grok',
  elevenlabs: 'ElevenLabs',
  soniox: 'Soniox',
  cartesia: 'Cartesia',
}

function judgeTargets() {
  const providers = useModelProvider.getState()
  const targets: {
    url: string
    key: string
    model: string
    extra: Record<string, unknown>
  }[] = []
  const cerebras = providers.getProviderByName('cerebras')
  if (cerebras?.api_key)
    targets.push({
      url: `${cerebras.base_url || 'https://api.cerebras.ai/v1'}/chat/completions`,
      key: cerebras.api_key,
      model: 'gpt-oss-120b',
      extra: {},
    })
  const groq = providers.getProviderByName('groq')
  if (groq?.api_key)
    targets.push({
      url: `${viaGroqProxy(groq.base_url || 'https://api.groq.com/openai/v1')}/chat/completions`,
      key: groq.api_key,
      model: 'openai/gpt-oss-20b',
      extra: { include_reasoning: false },
    })
  return targets
}

/**
 * Sends one prompt to the judge and returns the first reply `accept` takes.
 * Cerebras goes first; Groq joins after JUDGE_HEDGE_MS, or at once if
 * Cerebras fails, so one slow provider no longer runs into the timeout.
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
          // A failed first judge brings the backup in straight away
          if (started < targets.length) next()
        } finally {
          if (--pending === 0 && started === targets.length) resolve(undefined)
        }
      }
      const next = () => {
        const target = targets[started]
        if (target) void ask(target)
      }
      next()
      if (targets.length > 1) timers.push(setTimeout(next, JUDGE_HEDGE_MS))
      timers.push(setTimeout(() => resolve(undefined), timeoutMs))
    })
  } finally {
    timers.forEach(clearTimeout)
    controller.abort()
  }
}

/** Nothing to judge when two engines (nearly) agree: they outvote the rest. */
export function enginesAgree(results: EngineText[]): boolean {
  const heard = results.filter((r) => r.text)
  return (
    heard.length < 2 ||
    heard.some((a, i) =>
      heard
        .slice(i + 1)
        .some((b) => textAgreement(a.text, b.text) >= SKIP_AGREEMENT)
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
