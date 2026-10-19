import { ThreadMessage } from '@janhq/core'

/**
 * How long answers take to start in a fresh chat, per model, so a long chat
 * can be compared with it: the context meter turns amber or red only when
 * this chat's answers actually start later.
 */
export type ReplySample = { model: string; fresh: boolean; s: number }

type Timings = {
  model_used?: string
  history_messages?: number
  wait_for_first_byte_s?: number
  tab_hidden_at_send?: boolean
}

const STORAGE_KEY = 'reply-first-byte'
const MAX_SAMPLES = 200
/** A request with this few messages (instructions and one question) is a fresh chat. */
const FRESH_MESSAGES = 3
/** Fresh-chat replies needed before a model has a baseline. */
const MIN_BASELINE = 3
/** This chat's latest replies, compared with the baseline. */
const RECENT_REPLIES = 3
/** Slower than a fresh chat by this much: amber, then red. */
export const SLOWER_S = 0.5
export const MUCH_SLOWER_S = 1.5

export function readSamples(): ReplySample[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(saved) ? (saved as ReplySample[]) : []
  } catch {
    return []
  }
}

/** Remembers when one reply started; a background tab's timing is skipped. */
export function recordReply(t: Timings) {
  const s = t.wait_for_first_byte_s
  if (!t.model_used || typeof s !== 'number' || t.tab_hidden_at_send) return
  const sample: ReplySample = {
    model: t.model_used,
    fresh: (t.history_messages ?? Infinity) <= FRESH_MESSAGES,
    s,
  }
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...readSamples(), sample].slice(-MAX_SAMPLES))
    )
  } catch {
    // Storage blocked
  }
}

const median = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The typical start of an answer from this model in a fresh chat. */
export function freshBaseline(
  model: string,
  samples: ReplySample[]
): number | undefined {
  const fresh = samples.filter((x) => x.fresh && x.model === model)
  return fresh.length >= MIN_BASELINE
    ? median(fresh.map((x) => x.s))
    : undefined
}

export type ChatDelay = {
  model: string
  /** This chat's latest answers start after this long (median). */
  recentS: number
  /** A fresh chat's answers from the same model start after this long. */
  baselineS: number
  delayS: number
  level: 'light' | 'medium' | 'heavy'
}

/**
 * How much later this chat's latest answers start than a fresh chat's, from
 * the timings saved on each answer. Undefined until there is something to
 * compare (an answer here and a few fresh-chat answers from the same model).
 */
export function chatDelay(
  messages: ThreadMessage[],
  samples: ReplySample[] = readSamples()
): ChatDelay | undefined {
  const timed = messages
    .map((m) => (m.metadata as { timings?: Timings } | undefined)?.timings)
    .filter(
      (
        t
      ): t is Timings & { model_used: string; wait_for_first_byte_s: number } =>
        !!t?.model_used &&
        typeof t.wait_for_first_byte_s === 'number' &&
        !t.tab_hidden_at_send
    )
  const latest = timed.at(-1)
  if (!latest) return undefined
  const model = latest.model_used
  const baselineS = freshBaseline(model, samples)
  if (baselineS === undefined) return undefined
  const recentS = median(
    timed
      .filter((t) => t.model_used === model)
      .slice(-RECENT_REPLIES)
      .map((t) => t.wait_for_first_byte_s)
  )
  const delayS = Math.max(0, recentS - baselineS)
  const level =
    delayS >= MUCH_SLOWER_S ? 'heavy' : delayS >= SLOWER_S ? 'medium' : 'light'
  return { model, recentS, baselineS, delayS, level }
}
