import {
  HISTORY_SECONDS,
  isWait,
  JUDGE_MODELS,
  pickRelevant,
  type GroqConfig,
  type JudgeModel,
  type RecentClip,
  type Verdict,
} from './speakerFilter'
import { JUDGE_CASES, JUDGE_CASE_TERMS, type JudgeCase } from './judgeCases'

/** One judge's score on the test clips. */
export type BenchResult = {
  judge: JudgeModel
  label: string
  right: number
  total: number
  medianMs: number
  slowestMs: number
  /** Clips the picked model didn't answer (a backup model did). */
  backup: number
  misses: string[]
  error?: string
}

const outcome = (v: Verdict) =>
  isWait(v) ? 'wait' : v === null ? 'skip' : 'send'

const isRight = (expect: JudgeCase['expect'], got: string) =>
  expect === 'join'
    ? got !== 'skip'
    : expect === 'skip'
      ? got !== 'send'
      : got === 'send'

/**
 * Judges that have the keys they need. Groq gpt-oss-20b is left out: it is
 * the weakest, and the Groq judges share which model they last used.
 */
export function availableJudges(config: GroqConfig): JudgeModel[] {
  return JUDGE_MODELS.map((m) => m.value).filter((j) =>
    j === 'groq-20b'
      ? false
      : j.startsWith('claude')
        ? !!config.anthropic?.apiKey
        : j.startsWith('cerebras')
          ? !!config.cerebras?.apiKey
          : !!config.apiKey
  )
}

/**
 * Runs each judge over the test clips from real interviews, with wait mode
 * on as it was then, and scores it. Judges run side by side; each judge's
 * clips run one after another, so timings are like a live interview.
 */
export async function compareJudges(
  config: GroqConfig,
  judges: JudgeModel[],
  onResult?: (result: BenchResult) => void,
  cases: JudgeCase[] = withInterview(JUDGE_CASES)
): Promise<BenchResult[]> {
  return Promise.all(
    judges.map(async (judge) => {
      const label = JUDGE_MODELS.find((m) => m.value === judge)?.label ?? judge
      const times: number[] = []
      const misses: string[] = []
      let right = 0
      let backup = 0
      let error: string | undefined
      for (const c of cases) {
        let ms = 0
        let model = ''
        try {
          const verdict = await pickRelevant(
            c.texts,
            {
              ...config,
              judge,
              coding: c.coding,
              keyterms: JUDGE_CASE_TERMS,
            },
            c.recent,
            (info) => {
              ms = info.ms
              model = info.model
            },
            'wait'
          )
          const got = outcome(verdict)
          times.push(ms)
          if (!usedJudge(judge, model)) backup++
          if (isRight(c.expect, got)) right++
          else
            misses.push(
              `${c.at} expected ${c.expect}, got ${got}: "${c.texts[0]}"`
            )
        } catch (err) {
          error = err instanceof Error ? err.message : String(err)
          misses.push(`${c.at} failed: ${error}`)
        }
      }
      const sorted = [...times].sort((a, b) => a - b)
      const result: BenchResult = {
        judge,
        label,
        right,
        total: cases.length,
        medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
        slowestMs: sorted[sorted.length - 1] ?? 0,
        backup,
        misses,
        ...(error ? { error } : {}),
      }
      onResult?.(result)
      return result
    })
  )
}

const seconds = (clock: string) => {
  const [h, m, sec] = clock.split(':').map(Number)
  return h * 3600 + m * 60 + sec
}
const sameText = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * Gives each test clip the interview heard before it, as the live judge sees
 * it: every earlier clip the cases know the time of (the cases' own clips and
 * their recent clips), within the last few minutes, ahead of its recent clips.
 */
export function withInterview(cases: JudgeCase[]): JudgeCase[] {
  const sentTexts = new Set(
    cases.flatMap((c) =>
      c.recent.filter((r) => r.sent).map((r) => sameText(r.text))
    )
  )
  const heard = new Map<string, { text: string; sent: boolean; at: number }>()
  const hear = (text: string, sent: boolean, at: number) => {
    const key = sameText(text)
    if (key && !heard.has(key)) heard.set(key, { text, sent, at })
  }
  for (const c of cases) {
    const at = seconds(c.at)
    for (const r of c.recent)
      if (r.ago !== undefined) hear(r.text, r.sent, at - r.ago)
    hear(c.texts[0], sentTexts.has(sameText(c.texts[0])), at)
  }
  return cases.map((c) => {
    const at = seconds(c.at)
    const known = new Set(
      [...c.recent.map((r) => r.text), ...c.texts].map(sameText)
    )
    const earlier: RecentClip[] = [...heard.entries()]
      .filter(
        ([key, h]) =>
          h.at < at && at - h.at <= HISTORY_SECONDS && !known.has(key)
      )
      .sort((a, b) => a[1].at - b[1].at)
      .map(([, h]) => ({ text: h.text, sent: h.sent, ago: at - h.at }))
    return earlier.length ? { ...c, recent: [...earlier, ...c.recent] } : c
  })
}

/** Whether the model that answered is the judge that was picked. */
function usedJudge(judge: JudgeModel, model: string) {
  // Plain chatter never reaches a judge
  if (model === 'local chatter rule') return true
  if (judge === 'claude-haiku') return model.includes('claude-haiku')
  if (judge === 'claude-sonnet') return model.includes('claude-sonnet')
  if (judge === 'cerebras-120b-think') return model.includes('(medium)')
  if (judge === 'cerebras-120b') return model.startsWith('cerebras/')
  if (judge === 'groq-120b') return model.includes('120b')
  return model.includes('20b')
}

/** Plain-text results, to copy into a message. */
export function formatBench(results: BenchResult[]): string {
  return results
    .map(
      (r) =>
        `${r.label}: ${r.right}/${r.total} right, median ${(r.medianMs / 1000).toFixed(2)} s, slowest ${(r.slowestMs / 1000).toFixed(2)} s${r.backup ? `, ${r.backup} answered by backup` : ''}${r.misses.length ? `\n  ${r.misses.join('\n  ')}` : ''}`
    )
    .join('\n\n')
}
