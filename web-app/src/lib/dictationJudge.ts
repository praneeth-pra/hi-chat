import { groqFetch, viaBackupRoute } from '@/lib/groqProxy'
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

export const DICTATION_JUDGE_PROMPT = `You get one dictation, transcribed by several speech engines. Write the single most accurate version of what the speaker said. Where the engines differ, use the wording most of them agree on, unless a version only some of them heard matches a key term. Where they heard different words at the same spot, choose one of them; never join both (not "CNAPP and AWS" when one engine heard CNAPP and another AWS). Every engine was given the key terms. Only use words at least one engine heard: a key term can decide between the engines' versions, but never put in a word none of them heard. Leave out filler words such as uh and um. Keep the speaker's own words and punctuate them; do not answer, summarise, shorten or rephrase. Reply with only the text.`

const ENGINE_NAMES: Record<string, string> = {
  elevenlabs: 'ElevenLabs',
  azure: 'Azure',
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
      const base = direct ? own : viaBackupRoute(own)!
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
/** Which judge model wrote the last reply used, and how long it took. */
export let lastJudge: { model: string; ms: number } | undefined

async function askJudge(
  system: string,
  user: string,
  fetcher: typeof fetch,
  timeoutMs: number,
  accept: (text: string) => boolean = (text) => !!text
): Promise<string | undefined> {
  const targets = judgeTargets()
  lastJudge = undefined
  if (!targets.length) return undefined
  const askedAt = Date.now()
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
          if (accept(text)) {
            lastJudge ??= { model: target.model, ms: Date.now() - askedAt }
            return resolve(text)
          }
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

/** Lower-case letters and digits only, so "S3", "s 3" and "S-3" compare. */
const squash = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** One letter added, dropped or changed at most. */
function nearlySame(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  const [x, y] = [a.slice(i), b.slice(i)]
  return x.slice(1) === y.slice(1) || x.slice(1) === y || x === y.slice(1)
}

/** Each word of a text, and each pair of neighbours run together ("s 3"). */
function wordsAndPairs(text: string): string[] {
  const w = words(text).map(squash).filter(Boolean)
  return [...w, ...w.slice(1).map((x, i) => w[i] + x)]
}

/** Each key term run together, and each of its words. */
function termForms(keyterms: string[]): string[] {
  return keyterms.flatMap((t) => [squash(t), ...words(t).map(squash)])
}

/**
 * True when the engines differ on a word that is, or is a letter off, one of
 * the speaker's key terms ("Lambda" against "Learn"): a vote could pick the
 * wrong one, so the judge decides.
 */
function differOnKeyTerm(heard: EngineText[], keyterms: string[]): boolean {
  // Whole terms may be a letter off; single words of a longer term must
  // match exactly, so "time" in "time complexity" doesn't catch "tame"
  const whole = keyterms.map(squash).filter((t) => t.length > 1)
  const parts = keyterms
    .flatMap((t) => words(t).map(squash))
    .filter((w) => w.length > 2 || /\d/.test(w))
  if (!whole.length) return false
  const forms = heard.map((r) => new Set(wordsAndPairs(r.text)))
  const differing = new Set(
    forms.flatMap((f) => [...f]).filter((w) => !forms.every((f) => f.has(w)))
  )
  return [...differing].some(
    (w) =>
      parts.includes(w) ||
      whole.some((t) => w === t || (t.length >= 4 && nearlySame(w, t)))
  )
}

/**
 * Nothing to judge when two engines (nearly) agree and a third can outvote a
 * word one of them misheard. With only two texts, any word they differ on
 * goes to the judge: there is no third to break the tie. Nor when they
 * differ on a key term.
 */
export function enginesAgree(
  results: EngineText[],
  keyterms: string[] = []
): boolean {
  const heard = results.filter((r) => r.text)
  if (heard.length < 2) return true
  if (differOnKeyTerm(heard, keyterms)) return false
  const enough = heard.length > 2 ? SKIP_AGREEMENT : 1
  return heard.some((a, i) =>
    heard.slice(i + 1).some((b) => textAgreement(a.text, b.text) >= enough)
  )
}

/**
 * Every word of the judge's reply was heard by an engine or is in a key term
 * (two words may run together or split apart: "cloud formation" and
 * "CloudFormation"), so the judge chose between the engines and did not
 * reword them.
 */
export function onlyHeardWords(
  reply: string,
  results: EngineText[],
  keyterms: string[] = []
): boolean {
  const known = new Set([
    ...results.flatMap((r) => wordsAndPairs(r.text)),
    ...termForms(keyterms),
  ])
  const w = words(reply).map(squash).filter(Boolean)
  return w.every(
    (x, i) =>
      known.has(x) ||
      (i > 0 && known.has(w[i - 1] + x)) ||
      (i + 1 < w.length && known.has(x + w[i + 1]))
  )
}

/**
 * The judge waits for whole replies (no streaming), so a hedge would send a
 * second request on most clips: the backup route is only for a failed one.
 */
const JUDGE_HEDGE_MS = 2000
const judgeFetch: typeof fetch = (input, init) =>
  groqFetch(input, init, fetch, JUDGE_HEDGE_MS)

/**
 * The judge chooses between the engines' words, so its reply is no longer
 * than the longest one heard; a longer reply joined two versions of one
 * spot ("CNAPP and AWS").
 */
export function notLonger(reply: string, results: EngineText[]): boolean {
  const longest = Math.max(0, ...results.map((r) => words(r.text).length))
  return words(reply).length <= longest
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
  fetcher: typeof fetch = judgeFetch,
  timeoutMs = JUDGE_TIMEOUT_MS
): Promise<string | undefined> {
  lastJudge = undefined
  if (enginesAgree(results, keyterms)) return undefined
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
      !!clean(reply) &&
      textAgreement(clean(reply), vote) >= MIN_AGREEMENT &&
      onlyHeardWords(clean(reply), results, keyterms) &&
      notLonger(clean(reply), results)
  )
  return reply === undefined ? undefined : clean(reply)
}
