import { ThreadMessage } from '@janhq/core'

/**
 * How much a long chat delays the start of its answers, measured. Each
 * answer's start (first byte) is split using the provider's own report
 * (Groq, Cerebras):
 * - queue: waiting its turn at the provider. Load, not the chat: left out.
 * - reading: the provider reading the request, which grows with the chat.
 * - sending: everything else, mostly uploading the request (images).
 * The chat's cost is reading + sending, compared with a fresh chat's from
 * the same model. On 18-19 Oct a fresh gpt-oss-20b answer started after
 * about 0.16 s, so 0.3 s more is already twice as slow.
 */
export type ReplySample = {
  model: string
  fresh: boolean
  /** First byte, seconds after sending. */
  s: number
  /** The provider's queue time, when it reports one. */
  q?: number
  /** The provider's prompt (reading) time, when it reports one. */
  p?: number
}

type Timings = {
  model_used?: string
  history_messages?: number
  wait_for_first_byte_s?: number
  tab_hidden_at_send?: boolean
  auto_mode?: string
  provider_queue_s?: unknown
  provider_prompt_s?: unknown
}

const STORAGE_KEY = 'reply-first-byte'
const MAX_SAMPLES = 200
/** A request with this few messages (instructions and one question) is a fresh chat. */
const FRESH_MESSAGES = 3
/** Fresh-chat answers needed before a model has a baseline. */
const MIN_BASELINE = 3
/** This chat's latest answers, compared with the baseline. */
const RECENT_REPLIES = 3
/** Answers starting this much later than a fresh chat's: amber, then red. */
export const SLOWER_S = 0.3
export const MUCH_SLOWER_S = 1

const num = (x: unknown) =>
  typeof x === 'number' && Number.isFinite(x) ? x : undefined

function toSample(t: Timings): ReplySample | undefined {
  const s = num(t.wait_for_first_byte_s)
  // Accuracy's start includes the web search and its longer grounded
  // request: that is the mode's cost, not the chat's.
  if (!t.model_used || s === undefined || t.tab_hidden_at_send) return
  if (t.auto_mode === 'accuracy') return
  return {
    model: t.model_used,
    fresh: (t.history_messages ?? Infinity) <= FRESH_MESSAGES,
    s,
    q: num(t.provider_queue_s),
    p: num(t.provider_prompt_s),
  }
}

/** What the chat costs an answer: its start, less the provider's queue. */
const cost = (x: ReplySample) => Math.max(0, x.s - (x.q ?? 0))

export function readSamples(): ReplySample[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(saved) ? (saved as ReplySample[]) : []
  } catch {
    return []
  }
}

/** Remembers one answer's timings; a background tab's are skipped. */
export function recordReply(t: Timings) {
  const sample = toSample(t)
  if (!sample) return
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

const reading = (xs: ReplySample[]) => {
  const known = xs.map((x) => x.p).filter((p): p is number => p !== undefined)
  return known.length ? median(known) : undefined
}

/** The typical cost of a fresh-chat answer from this model. */
export function freshBaseline(
  model: string,
  samples: ReplySample[]
): number | undefined {
  const fresh = samples.filter((x) => x.fresh && x.model === model)
  return fresh.length >= MIN_BASELINE ? median(fresh.map(cost)) : undefined
}

export type ChatDelay = {
  model: string
  /** This chat's latest answers cost this long (median). */
  recentS: number
  /** A fresh chat's answers from the same model cost this long. */
  baselineS: number
  delayS: number
  /** Of the delay, the provider reading the longer request, when reported. */
  readingS?: number
  level: 'light' | 'medium' | 'heavy'
}

/**
 * How much later this chat's latest answers start than a fresh chat's, from
 * the timings saved on each answer. Undefined until there is something to
 * compare: an answer here and a few fresh-chat answers from the same model.
 */
export function chatDelay(
  messages: ThreadMessage[],
  samples: ReplySample[] = readSamples()
): ChatDelay | undefined {
  const timed = messages
    .map((m) =>
      toSample(
        ((m.metadata as { timings?: Timings } | undefined)?.timings ??
          {}) as Timings
      )
    )
    .filter((x): x is ReplySample => !!x)
  const latest = timed.at(-1)
  if (!latest) return undefined
  const model = latest.model
  const baselineS = freshBaseline(model, samples)
  if (baselineS === undefined) return undefined
  const recent = timed.filter((x) => x.model === model).slice(-RECENT_REPLIES)
  const recentS = median(recent.map(cost))
  const delayS = Math.max(0, recentS - baselineS)
  const fresh = samples.filter((x) => x.fresh && x.model === model)
  const [nowReading, freshReading] = [reading(recent), reading(fresh)]
  const readingS =
    nowReading !== undefined && freshReading !== undefined
      ? Math.min(delayS, Math.max(0, nowReading - freshReading))
      : undefined
  const level =
    delayS >= MUCH_SLOWER_S ? 'heavy' : delayS >= SLOWER_S ? 'medium' : 'light'
  return { model, recentS, baselineS, delayS, readingS, level }
}
