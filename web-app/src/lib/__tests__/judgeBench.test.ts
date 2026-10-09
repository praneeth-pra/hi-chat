import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  availableJudges,
  compareJudges,
  formatBench,
  withInterview,
} from '../judgeBench'
import { HISTORY_SECONDS } from '../speakerFilter'
import type { JudgeCase } from '../judgeCases'
import { JUDGE_CASES } from '../judgeCases'

const cases: JudgeCase[] = [
  {
    at: '1',
    texts: ['What is a pod?'],
    recent: [],
    coding: false,
    expect: 'send',
  },
  { at: '2', texts: ['Is that clear?'], recent: [], coding: false, expect: 'skip' },
  {
    at: '3',
    texts: ['The failed test.'],
    recent: [],
    coding: true,
    expect: 'join',
  },
]

describe('judgeBench', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('gives each test clip the last few minutes of its interview', () => {
    const replayed = withInterview(JUDGE_CASES)
    expect(replayed).toHaveLength(JUDGE_CASES.length)
    const added = replayed.map(
      (c, i) => c.recent.length - JUDGE_CASES[i].recent.length
    )
    // Most clips gain earlier history; the first of each interview gains none
    expect(added.filter((n) => n > 0).length).toBeGreaterThan(
      JUDGE_CASES.length / 2
    )
    expect(added[0]).toBe(0)
    replayed.forEach((c, i) => {
      const extra = c.recent.slice(0, added[i])
      for (const r of extra) {
        expect(r.ago).toBeGreaterThan(0)
        expect(r.ago).toBeLessThanOrEqual(HISTORY_SECONDS)
      }
      // Earlier history is oldest first and keeps the case's own recent clips last
      expect(extra.map((r) => r.ago)).toEqual(
        [...extra.map((r) => r.ago)].sort((a, b) => b! - a!)
      )
      expect(c.recent.slice(added[i])).toEqual(JUDGE_CASES[i].recent)
    })
  })

  it('only offers judges that have keys', () => {
    expect(availableJudges({ cerebras: { apiKey: 'c' } })).toEqual([
      'cerebras-120b',
      'cerebras-120b-think',
    ])
    expect(availableJudges({ anthropic: { apiKey: 'a' } })).toEqual([
      'claude-haiku',
      'claude-sonnet',
    ])
  })

  it('scores each judge and lists its misses', async () => {
    // Says YES to everything: right on send and join, wrong on skip.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'YES' } }] }),
      }))
    )
    const [result] = await compareJudges(
      { cerebras: { apiKey: 'c' } },
      ['cerebras-120b'],
      undefined,
      cases
    )
    expect(result.right).toBe(2)
    expect(result.total).toBe(3)
    expect(result.backup).toBe(0)
    expect(result.misses).toEqual(['2 expected skip, got send: "Is that clear?"'])
    expect(formatBench([result])).toContain('Cerebras gpt-oss-120b: 2/3 right')
  })

  it('has labelled cases from real interviews', () => {
    expect(JUDGE_CASES.length).toBeGreaterThan(50)
    for (const c of JUDGE_CASES) expect(c.texts.length).toBeGreaterThan(0)
  })
})
