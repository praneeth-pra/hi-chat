import { groqRoute } from '@/lib/groqProxy'
import { CHAT_MODELS } from '@/lib/chatModels'

/** When each stage of one streamed reply happened, for the message's info dialog. */
export type StreamTiming = {
  firstChunkAt?: number
  /** The model's first thinking word; before it, the provider was reading the question. */
  firstThoughtAt?: number
  firstAnswerAt?: number
  usage?: Record<string, unknown>
  /** The provider's `created` stamp (Unix seconds) on the first chunk. */
  providerCreated?: number
  hiddenAtStart?: boolean
  hiddenAtFirstChunk?: boolean
  /** Every HTTP request the SDK made for this reply, retries included. */
  attempts?: FetchAttempt[]
  /** Models skipped for this reply (Settings > General chat model order), and why. */
  fallbacks?: string[]
  autoMode?: 'speed' | 'accuracy' | 'instant'
  /** Auto · Instant: the thinking level picked for this question. */
  effort?: 'low' | 'medium'
  /** A dictated question: when you stopped speaking (ms since epoch). */
  dictationStoppedAt?: number
  autoEvents?: {
    model: string
    provider: string
    event: string
    atMs: number
    hidden?: boolean
    reason?: string
  }[]
}

/** One HTTP request to the provider: when it started, its status and headers. */
export type FetchAttempt = {
  sent_at_s: number
  headers_after_s: number
  status?: number
  retry_after?: string
  remaining_requests?: string
  remaining_tokens?: string
  error?: string
  /** Groq only: straight to Groq, or through this site's server. */
  route?: 'direct' | 'server'
}

/**
 * Wraps fetch so each request the SDK makes is recorded. The SDK retries 429s
 * and 5xx errors on its own, so without this a retry only shows up as a slow
 * reply.
 */
export function trackFetch(
  base: typeof fetch,
  attempts: FetchAttempt[],
  start: number
): typeof fetch {
  return async (input, init) => {
    const sent = Date.now()
    const attempt: FetchAttempt = {
      sent_at_s: seconds(sent - start)!,
      headers_after_s: 0,
    }
    attempts.push(attempt)
    try {
      const res = await base(input, init)
      attempt.headers_after_s = seconds(Date.now() - sent)!
      attempt.status = res.status
      attempt.route = groqRoute(res)
      const header = (name: string) => res.headers.get(name) ?? undefined
      attempt.retry_after = header('retry-after')
      attempt.remaining_requests = header('x-ratelimit-remaining-requests')
      attempt.remaining_tokens = header('x-ratelimit-remaining-tokens')
      return res
    } catch (err) {
      attempt.headers_after_s = seconds(Date.now() - sent)!
      attempt.error = err instanceof Error ? err.message : String(err)
      throw err
    }
  }
}

/** True when the tab is in the background, where browsers slow pages down. */
export const pageHidden = () =>
  typeof document !== 'undefined' ? document.hidden : undefined

const seconds = (ms: number | undefined) =>
  ms === undefined ? undefined : Math.round(ms) / 1000

/**
 * Where the time went on one reply: waiting for the provider's first byte,
 * thinking (reasoning before the first answer word), then writing the answer.
 */
export function describeTiming(
  start: number,
  end: number,
  timing: StreamTiming,
  request: { messages: number; chars: number; tools: number; model?: string }
) {
  const { firstChunkAt, firstThoughtAt, firstAnswerAt, usage, providerCreated } =
    timing
  // Thinking starts at the first thinking word: Groq sends its first byte
  // before reading the question, and a long question (large assistant
  // documents) took seconds to read that showed as "Thought for 3s"
  const thinkingFrom =
    firstThoughtAt && firstAnswerAt && firstThoughtAt <= firstAnswerAt
      ? firstThoughtAt
      : firstChunkAt
  const u = usage ?? {}
  const details = u.completion_tokens_details as
    | { reasoning_tokens?: number }
    | undefined
  const promptDetails = u.prompt_tokens_details as
    | { cached_tokens?: number }
    | undefined
  return {
    total_s: seconds(end - start),
    wait_for_first_byte_s: seconds(firstChunkAt && firstChunkAt - start),
    thinking_s: seconds(
      thinkingFrom && firstAnswerAt && firstAnswerAt - thinkingFrom
    ),
    // First byte → first thinking word: the provider reading the question
    reading_s: seconds(
      firstChunkAt && thinkingFrom && thinkingFrom - firstChunkAt
    ),
    answer_s: seconds(firstAnswerAt && end - firstAnswerAt),
    // When the provider started the reply, counted from the send. Whole
    // seconds, and off by any difference between this computer's clock and
    // the provider's: large means the request reached the provider late,
    // small with a long wait means the reply reached the page late.
    provider_started_after_s:
      typeof providerCreated === 'number'
        ? Math.round(providerCreated - start / 1000)
        : undefined,
    requests: timing.attempts,
    fallbacks: timing.fallbacks,
    auto_mode: timing.autoMode,
    auto_race: timing.autoEvents,
    // The model that actually answered (image questions go to a vision model)
    model_used: request.model,
    // Its name as Settings shows it, e.g. "Groq gpt-oss-120b"
    answered_by:
      CHAT_MODELS.find((m) => m.model === request.model)?.label ??
      request.model,
    tab_hidden_at_send: timing.hiddenAtStart,
    tab_hidden_at_first_byte: timing.hiddenAtFirstChunk,
    history_messages: request.messages,
    request_chars: request.chars,
    tools_sent: request.tools,
    prompt_tokens: u.prompt_tokens,
    // The part of the prompt the provider had cached: read for free and fast
    cached_tokens: promptDetails?.cached_tokens,
    completion_tokens: u.completion_tokens,
    reasoning_tokens: details?.reasoning_tokens,
    provider_queue_s: u.queue_time,
    provider_prompt_s: u.prompt_time,
    provider_generation_s: u.completion_time,
  }
}

/**
 * One Railway log line per reply outside Accuracy, with timings only (no question
 * or answer text): `speed: model=… total=…ms first_byte=…ms first_words=…ms
 * answer=…ms tokens=N prompt_tokens=N cached=N queue=…ms prompt=…ms request=NKB
 * shown=…ms stalls=N route=direct|server|none hidden=yes|no`. queue and prompt are the
 * provider's own times (Groq, Cerebras): waiting its turn, and reading the
 * request, which is what grows with a long chat.
 */
export function speedLogLine(
  timings: ReturnType<typeof describeTiming>,
  frames?: { shownMs: number | undefined; stalls: number },
  extra?: {
    mode: 'speed' | 'accuracy' | 'instant' | 'manual'
    effort?: 'low' | 'medium'
    /** Stopped speaking → first answer word on screen, for dictated questions. */
    fromStopMs?: number
  }
) {
  const ms = (s: number | undefined) =>
    typeof s === 'number' && Number.isFinite(s)
      ? `${Math.max(0, Math.round(s * 1000))}ms`
      : 'none'
  const first =
    (timings.wait_for_first_byte_s ?? 0) +
    (timings.reading_s ?? 0) +
    (timings.thinking_s ?? 0)
  const route =
    [...(timings.requests ?? [])].reverse().find((attempt) => attempt.route)
      ?.route ?? 'none'
  return [
    'speed:',
    `model=${(timings.model_used ?? 'none').replace(/[^\w.:,-]/g, '_')}`,
    `total=${ms(timings.total_s)}`,
    `first_byte=${ms(timings.wait_for_first_byte_s)}`,
    `first_words=${timings.wait_for_first_byte_s === undefined ? 'none' : ms(first)}`,
    `answer=${ms(timings.answer_s)}`,
    `tokens=${Math.max(0, Math.round(Number(timings.completion_tokens) || 0))}`,
    `prompt_tokens=${Math.max(0, Math.round(Number(timings.prompt_tokens) || 0))}`,
    `cached=${Math.max(0, Math.round(Number(timings.cached_tokens) || 0))}`,
    `queue=${ms(Number(timings.provider_queue_s))}`,
    `prompt=${ms(Number(timings.provider_prompt_s))}`,
    `request=${Math.round((timings.request_chars ?? 0) / 1024)}KB`,
    // How it looked: the next frame after sending (the answer's place
    // appearing) and stutters (drawing stalled over 50 ms) until it finished
    ...(frames
      ? [
          `shown=${frames.shownMs === undefined ? 'none' : `${Math.max(0, Math.round(frames.shownMs))}ms`}`,
          `stalls=${Math.max(0, Math.round(frames.stalls))}`,
        ]
      : []),
    `route=${route}`,
    `hidden=${timings.tab_hidden_at_send ? 'yes' : 'no'}`,
    // Which Auto mode, the thinking level asked for, the thinking it took,
    // and for a dictated question the whole wait: stop speaking → first word
    ...(extra
      ? [
          `mode=${extra.mode}`,
          `effort=${extra.effort ?? 'default'}`,
          `reasoning=${Math.max(0, Math.round(Number(timings.reasoning_tokens) || 0))}`,
          `from_stop=${extra.fromStopMs === undefined ? 'none' : `${Math.max(0, Math.round(extra.fromStopMs))}ms`}`,
        ]
      : []),
  ].join(' ')
}
