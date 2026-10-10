import {
  JUDGE_TIMEOUT_MS,
  enginesAgree,
  judgeDictation,
  judgeSpots,
  textAgreement,
  type EngineText,
} from '@/lib/dictationJudge'
import { pickBest } from '@/lib/dictation'
import {
  keyTerms,
  reportClip,
} from '@/lib/speakerCaptureSession'

/**
 * Settings > Dictation judge test: replays logged Auto dictations through
 * today's judge and the spots-only judge (dictationJudge.ts), so the two can
 * be compared word for word before the faster one is used for real.
 */

export type JudgeSample = { at: string; texts: Record<string, string> }

export type JudgeTestRow = {
  at: string
  full?: string
  spots?: string
  fullMs: number
  spotsMs: number
  same: boolean
  agreement: number
}

/** Generous, so a slow answer is still compared (and counted as slow). */
const TEST_TIMEOUT_MS = 6000

export async function loadJudgeSamples(): Promise<JudgeSample[]> {
  const res = await fetch('/api/judge-samples', {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`samples: status ${res.status}`)
  return res.json()
}

async function timed<T>(run: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now()
  const value = await run()
  return [value, Math.round(performance.now() - start)]
}

export async function runJudgeTest(
  samples: JudgeSample[],
  onProgress?: (done: number, total: number) => void
): Promise<JudgeTestRow[]> {
  const terms = keyTerms()
  const cases = samples
    .map((s) => ({
      at: s.at,
      results: Object.entries(s.texts).map(
        ([engine, text]): EngineText => ({ engine, text })
      ),
    }))
    // Only dictations today's judge would be asked about
    .filter((c) => !enginesAgree(c.results))
  const rows: JudgeTestRow[] = []
  for (const [n, c] of cases.entries()) {
    const vote = pickBest(c.results)!
    const full = () =>
      timed(() =>
        judgeDictation(c.results, vote.text, terms, undefined, TEST_TIMEOUT_MS)
      )
    const spots = () =>
      timed(() =>
        judgeSpots(c.results, vote, terms, undefined, TEST_TIMEOUT_MS)
      )
    // Alternate which goes first, so neither always gets a warm connection
    const [[a, fullMs], [b, spotsMs]] =
      n % 2
        ? await full().then(async (f) => [f, await spots()] as const)
        : await spots().then(async (s) => [await full(), s] as const)
    const agreement = a && b ? textAgreement(a, b) : 0
    const row = {
      at: c.at,
      full: a,
      spots: b,
      fullMs,
      spotsMs,
      same: agreement === 1,
      agreement,
    }
    rows.push(row)
    reportClip(
      `judge test ${row.at}: ${row.same ? 'same' : `differs ${agreement.toFixed(2)}`} full=${fullMs}ms spots=${spotsMs}ms | vote(${vote.engine}): ${JSON.stringify(vote.text)} | full: ${JSON.stringify(a ?? null)} | spots: ${JSON.stringify(b ?? null)}`
    )
    onProgress?.(n + 1, cases.length)
  }
  reportClip(`judge test summary: ${judgeTestSummary(rows)}`)
  return rows
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

export function judgeTestSummary(rows: JudgeTestRow[]): string {
  const same = rows.filter((r) => r.same).length
  const slow = (k: 'fullMs' | 'spotsMs') =>
    rows.filter((r) => r[k] > JUDGE_TIMEOUT_MS).length
  return (
    `${same}/${rows.length} word for word the same. ` +
    `Today's judge: median ${(median(rows.map((r) => r.fullMs)) / 1000).toFixed(2)} s, ${slow('fullMs')} over 1.5 s. ` +
    `Spots only: median ${(median(rows.map((r) => r.spotsMs)) / 1000).toFixed(2)} s, ${slow('spotsMs')} over 1.5 s.`
  )
}
