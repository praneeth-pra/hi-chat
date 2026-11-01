import { applyFixes } from '@/lib/dictationFixes'
import { SKIP_AGREEMENT, textAgreement } from '@/lib/dictationJudge'
import { TEST_ENGINES, getAutoEngines, type DictationEngine } from './settings'
import { liveStream } from './engines'

// Auto: racing the live engines and choosing the text that goes out.

/**
 * Auto: once one engine has answered, how long the others get. On P's
 * questions all three live engines answered within 0.6 s of stopping.
 */
const AUTO_GRACE_MS = 1000
/**
 * The grace once another engine has already come back empty or failed: with
 * only two engines left, a slow Soniox held three clips in the 12 Oct mock
 * interview for 1.0-1.5 s although ElevenLabs had answered in 0.35-0.8 s.
 */
const AUTO_SHORT_GRACE_MS = 500
/**
 * Past the deadline (a network spike: on 25 Oct every engine took ~8 s),
 * the first text that arrives waits this long for the others, which tend to
 * land together; Cartesia's cut-off "...to your account? So" went out 73 ms
 * before another engine's whole question.
 */
const LATE_GRACE_MS = 200
/**
 * Auto: the text goes out by this long after you stop, whatever is late. In
 * the 12-14 Oct mock interviews 40 of 154 clips took longer, 32 of them
 * waiting on the judge. 1.2 s lets the judge finish on almost all of them
 * (its step took up to ~1.15 s). Past it the vote is sent; if no engine has text yet,
 * the first one to answer is sent as it arrives.
 */
export const AUTO_DEADLINE_MS = 1200
/** Less judge time than this left before the deadline: send the vote. */
export const MIN_JUDGE_MS = 150
/**
 * When the engines disagree the judge gets at least this long, even past
 * the deadline (Groq answers in 0.15-0.3 s), but the text still goes out
 * by JUDGE_DEADLINE_MS after you stop. When they agree there is no wait.
 */
export const JUDGE_FLOOR_MS = 800
export const JUDGE_DEADLINE_MS = 1600

/** The engines whose text decides what is sent: all but the ones on trial,
 * unless only engines on trial were chosen. */
export function countedEngines<T extends { engine: DictationEngine }>(
  jobs: T[]
): T[] {
  const trial = (e: DictationEngine) => TEST_ENGINES.includes(e)
  return jobs.some((j) => !trial(j.engine))
    ? jobs.filter((j) => !trial(j.engine))
    : jobs
}

export function autoLiveStreams() {
  // Cartesia first: when it agrees with another engine its text is sent
  // (it had the most words right on P's questions), then Soniox
  return getAutoEngines().map((engine) => ({
    engine,
    stream: liveStream(engine)!,
  }))
}

export type EngineText = { engine: DictationEngine; text: string }

/** Fewer words than this never go out on the fast path. */
const FAST_MIN_WORDS = 3

/**
 * Auto · Instant: resolves with the first engine's final text that matches,
 * word for word (fillers, punctuation and case aside, known fixes applied),
 * another engine's final text or, if that isn't in yet, what it has heard
 * live so far. Two engines agreeing is the same bar as before; the live text
 * just saves waiting ~250 ms for the slower engine to finish. Resolves
 * undefined when no final matches, and the usual comparison decides.
 */
export function fastAgreement(
  jobs: { engine: DictationEngine; text: Promise<string> }[],
  heardLive: Map<DictationEngine, string> | undefined
): Promise<
  (EngineText & { with: DictationEngine; live: boolean }) | undefined
> {
  return new Promise((resolve) => {
    const finals = new Map<DictationEngine, string>()
    let left = jobs.length
    if (!left) resolve(undefined)
    jobs.forEach(({ engine, text }) =>
      text
        .then((t) => {
          const mine = applyFixes(t.trim())
          if (mine.split(/\s+/).length >= FAST_MIN_WORDS)
            for (const other of jobs) {
              if (other.engine === engine) continue
              const final = finals.get(other.engine)
              const theirs = final ?? heardLive?.get(other.engine)
              if (theirs && textAgreement(mine, applyFixes(theirs)) === 1) {
                resolve({
                  engine,
                  text: t.trim(),
                  with: other.engine,
                  live: final === undefined,
                })
                break
              }
            }
          finals.set(engine, t.trim())
        })
        .catch(() => {})
        .finally(() => {
          if (--left === 0) resolve(undefined)
        })
    )
  })
}

/**
 * The text without "uh"/"um" (Cartesia and Soniox write them out) or a
 * leading "..." (ElevenLabs, when you start mid-sentence).
 */
export function withoutFillers(text: string): string {
  const clean = text
    .replace(/,?\s*\b(?:u+h+|u+m+|uhm|e+rm|h+m+|m{2,})\b[,.]?(?=\s|$)/gi, '')
    .replace(/^[\s.…,-]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  // Capitalise the start of each sentence a filler opened
  return clean.replace(
    /(^|[.?!]\s+)(\p{Ll})/gu,
    (_, end, c) => end + c.toUpperCase()
  )
}

/**
 * Auto: the text the other engines agree with most, since a word one engine
 * mishears the others usually get right. With a tie (or only two answers)
 * the earlier one wins: Cartesia, then Soniox.
 */
export function pickBest(results: EngineText[]): EngineText | undefined {
  const heard = results.filter((r) => r.text)
  if (heard.length < 3) return heard[0]
  let best = heard[0]
  let bestScore = -1
  for (const r of heard) {
    const score = heard
      .filter((o) => o !== r)
      .reduce((sum, o) => sum + textAgreement(r.text, o.text), 0)
    if (score > bestScore + 1e-9) {
      best = r
      bestScore = score
    }
  }
  return best
}

const FILLER_WORDS = new Set(['uh', 'um', 'uhm', 'umm', 'erm', 'hmm', 'mm'])
/** A word as compared: lower case, letters and digits only, fillers dropped. */
const contentWord = (w: string) => {
  const n = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  return n && !FILLER_WORDS.has(n) ? n : ''
}
/** At most this many words heard before the question get dropped. */
const MAX_STRAY_WORDS = 5

/**
 * Drops words one engine heard before the question began, when most of the
 * others start a few words later: one engine wrote "top rather than
 * the And also let me know..." and "you. When would you pick..." on 25 Oct,
 * where every other engine started at "And" / "When".
 */
export function trimStrayStart(results: EngineText[]): EngineText[] {
  return results.map((r) => {
    if (!r.text) return r
    const firsts = results
      .filter((o) => o !== r && o.text)
      .map((o) => o.text.split(/\s+/).map(contentWord).find(Boolean))
      .filter((w): w is string => !!w)
    if (firsts.length < 2) return r
    const counts = new Map<string, number>()
    for (const w of firsts) counts.set(w, (counts.get(w) ?? 0) + 1)
    const [start, votes] = [...counts].sort((a, b) => b[1] - a[1])[0]
    if (votes < 2 || votes * 2 <= firsts.length) return r
    const tokens = r.text.split(/\s+/).filter(Boolean)
    let seen = 0
    for (let i = 0; i < tokens.length && seen <= MAX_STRAY_WORDS; i++) {
      const w = contentWord(tokens[i])
      if (!w) continue
      if (w === start) {
        if (seen === 0) return r
        const rest = tokens.slice(i).join(' ')
        return { ...r, text: rest.charAt(0).toUpperCase() + rest.slice(1) }
      }
      seen++
    }
    return r
  })
}

/** The longest text that still agrees with `best` (cut-off texts are its start). */
export function longestAgreeing(
  results: EngineText[],
  best: EngineText | undefined
): EngineText | undefined {
  if (!best) return best
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length
  return results
    .filter((r) => r.text && textAgreement(r.text, best.text) >= 0.6)
    .reduce((a, b) => (words(b.text) > words(a.text) ? b : a), best)
}

/**
 * Waits for every engine, but only AUTO_GRACE_MS once the first has text,
 * not at all once two engines hear the same words, only AUTO_SHORT_GRACE_MS
 * more once two nearly agree (a third can outvote a word one of them
 * misheard: Cartesia's "one reason downtime" against "one region" from
 * Soniox and ElevenLabs on 18 Oct), and not past `deadlineMs` once any
 * engine has text.
 */
export function gatherAuto(
  jobs: { engine: DictationEngine; text: Promise<string> }[],
  deadlineMs?: number
): Promise<EngineText[]> {
  return new Promise((resolve, reject) => {
    const done: EngineText[] = []
    const errors: string[] = []
    let left = jobs.length
    let lateGrace: ReturnType<typeof setTimeout> | undefined
    let grace: ReturnType<typeof setTimeout> | undefined
    let late = false
    const deadline =
      deadlineMs === undefined
        ? undefined
        : setTimeout(() => {
            late = true
            if (done.some((d) => d.text)) finish()
          }, deadlineMs)
    const finish = () => {
      clearTimeout(grace)
      clearTimeout(lateGrace)
      clearTimeout(deadline)
      if (!done.length && errors.length) reject(new Error(errors.join('; ')))
      // Keep the engines' order, so ties go to the first (Cartesia)
      else
        resolve(jobs.flatMap((j) => done.filter((d) => d.engine === j.engine)))
    }
    jobs.forEach(({ engine, text }) =>
      text
        .then((t) => {
          const text = t.trim()
          const scores = text
            ? done.filter((d) => d.text).map((d) => textAgreement(d.text, text))
            : []
          done.push({ engine, text })
          if (scores.some((s) => s === 1)) finish()
          else if (late && text) {
            if (!lateGrace) lateGrace = setTimeout(finish, LATE_GRACE_MS)
          } else if (scores.some((s) => s >= SKIP_AGREEMENT)) {
            clearTimeout(grace)
            grace = setTimeout(finish, AUTO_SHORT_GRACE_MS)
          } else if (text && !grace)
            grace = setTimeout(
              finish,
              errors.length || done.some((d) => !d.text)
                ? AUTO_SHORT_GRACE_MS
                : AUTO_GRACE_MS
            )
        })
        .catch((err) => errors.push(`${engine}: ${(err as Error).message}`))
        .finally(() => {
          if (--left === 0) finish()
        })
    )
  })
}
