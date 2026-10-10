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

/** Sends one prompt to the judge; the reply's text, or undefined. */
async function askJudge(
  system: string,
  user: string,
  fetcher: typeof fetch,
  timeoutMs: number
): Promise<string | undefined> {
  const target = judgeTarget()
  if (!target) return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
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
    return (data.choices?.[0]?.message?.content ?? '').trim()
  } catch (err) {
    console.warn('Dictation judge skipped:', (err as Error).message)
    return undefined
  } finally {
    clearTimeout(timer)
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
  const reply = await askJudge(DICTATION_JUDGE_PROMPT, user, fetcher, timeoutMs)
  const text = reply?.replace(/^"(.*)"$/s, '$1').trim()
  if (!text || textAgreement(text, vote) < MIN_AGREEMENT) return undefined
  return text
}

/*
 * Experiment (Settings > Dictation judge test only): the judge gets the vote
 * with numbered spots where the engines differ, and answers just those spots,
 * so it has less to write. Shipped only if it matches judgeDictation.
 */

export const DICTATION_SPOTS_PROMPT = `You get one dictation, transcribed by several speech engines. The text is one engine's version, with numbered spots like [1: words] where the engines disagree; below it are each engine's words for every spot. For each spot, write what the speaker most likely said there. Use the wording most engines agree on, unless another one makes more sense in context or matches a key term. Soniox and Cartesia are given the speaker's own dictionary, so trust their spelling of names and technical words. Only use words at least one engine heard: a key term can decide between the engines' versions, but never put in a word none of them heard. Leave out filler words such as uh and um. Keep the speaker's own words; do not rephrase. Reply with one line per spot: the number, a colon, then the words (nothing after the colon to drop the spot's words).`

type Token = { raw: string; norm: string }

function tokens(text: string): Token[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const norm = words(raw).join(' ')
      return { raw, norm }
    })
}

/** For each word of a, the index of the word of b it lines up with (LCS). */
function align(a: Token[], b: Token[]): number[] {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  )
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] =
        a[i].norm && a[i].norm === b[j].norm
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
  const match = new Array<number>(n).fill(-1)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i].norm && a[i].norm === b[j].norm) {
      match[i] = j
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return match
}

export type Spot = { start: number; end: number; options: EngineText[] }

/**
 * The stretches of the vote (word ranges, end exclusive) where any engine
 * heard something else, with one word of context each side, and what each
 * engine heard there.
 */
export function findSpots(base: string, others: EngineText[]): Spot[] {
  const a = tokens(base)
  const aligned = others.map((o) => {
    const b = tokens(o.text)
    return { engine: o.engine, b, match: align(a, b) }
  })
  const differs = new Array<boolean>(a.length).fill(false)
  for (const { b, match } of aligned) {
    let lastJ = -1
    let lastI = -1
    for (let i = 0; i <= a.length; i++) {
      if (i < a.length && match[i] < 0) {
        if (a[i].norm) differs[i] = true
        continue
      }
      const j = i < a.length ? match[i] : b.length
      // Words the other engine has between two shared words
      const extra = b.slice(lastJ + 1, j).some((t) => t.norm)
      if (extra) {
        if (lastI >= 0) differs[lastI] = true
        if (i < a.length) differs[i] = true
      }
      lastJ = j
      lastI = i
    }
  }
  const ranges: [number, number][] = []
  for (let i = 0; i < a.length; i++) {
    if (!differs[i]) continue
    const start = Math.max(0, i - 1)
    const end = Math.min(a.length, i + 2)
    const last = ranges[ranges.length - 1]
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end)
    else ranges.push([start, end])
  }
  return ranges.map(([start, end]) => ({
    start,
    end,
    options: aligned.map(({ engine, b, match }) => {
      let from = 0
      for (let i = start - 1; i >= 0; i--)
        if (match[i] >= 0) {
          from = match[i] + 1
          break
        }
      let to = b.length
      for (let i = end; i < a.length; i++)
        if (match[i] >= 0) {
          to = match[i]
          break
        }
      return {
        engine,
        text: b
          .slice(from, Math.max(from, to))
          .map((t) => t.raw)
          .join(' '),
      }
    }),
  }))
}

/** The prompt for judgeSpots, and the vote's words to stitch answers into. */
export function spotsPrompt(
  results: EngineText[],
  vote: EngineText,
  keyterms: string[] = []
) {
  const others = results.filter((r) => r.text && r !== vote)
  const spots = findSpots(vote.text, others)
  const words = vote.text.split(/\s+/).filter(Boolean)
  const name = (e: string) => ENGINE_NAMES[e] ?? e
  let marked = ''
  let at = 0
  spots.forEach((s, n) => {
    marked += `${words.slice(at, s.start).join(' ')} [${n + 1}: ${words.slice(s.start, s.end).join(' ')}] `
    at = s.end
  })
  marked += words.slice(at).join(' ')
  const list = spots
    .map(
      (s, n) =>
        `Spot ${n + 1}:\n${name(vote.engine)}: "${words.slice(s.start, s.end).join(' ')}"\n${s.options
          .map((o) => `${name(o.engine)}: "${o.text}"`)
          .join('\n')}`
    )
    .join('\n\n')
  const user = `${keytermLine(keyterms)}Text (${name(vote.engine)}): ${marked.trim()}\n\n${list}`
  return { spots, words, user }
}

/** Puts the judge's answers for each spot into the vote's words. */
export function stitchSpots(words: string[], spots: Spot[], reply: string) {
  const answers = new Map<number, string>()
  for (const line of reply.split('\n')) {
    const m = line.match(/^\s*(?:spot\s*)?\[?(\d+)\]?\s*[:.)]\s*(.*)$/i)
    if (m) answers.set(Number(m[1]), m[2].trim().replace(/^"(.*)"$/s, '$1'))
  }
  let out: string[] = []
  let at = 0
  spots.forEach((s, n) => {
    out = out.concat(words.slice(at, s.start))
    const answer = answers.get(n + 1)
    out = out.concat(
      answer === undefined ? words.slice(s.start, s.end) : answer.split(/\s+/)
    )
    at = s.end
  })
  return out.concat(words.slice(at)).filter(Boolean).join(' ')
}

/** Like judgeDictation, but the judge only answers the spots that differ. */
export async function judgeSpots(
  results: EngineText[],
  vote: EngineText,
  keyterms: string[] = [],
  fetcher: typeof fetch = groqFetch,
  timeoutMs = JUDGE_TIMEOUT_MS
): Promise<string | undefined> {
  if (enginesAgree(results)) return undefined
  const { spots, words, user } = spotsPrompt(results, vote, keyterms)
  if (!spots.length) return undefined
  const reply = await askJudge(DICTATION_SPOTS_PROMPT, user, fetcher, timeoutMs)
  if (!reply) return undefined
  const text = stitchSpots(words, spots, reply)
  if (!text || textAgreement(text, vote.text) < MIN_AGREEMENT) return undefined
  return text
}
