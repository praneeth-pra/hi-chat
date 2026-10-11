import { groqRoute } from '@/lib/groqProxy'
import { CHAT_MODELS } from '@/lib/chatModels'

/** When each stage of one streamed reply happened, for the message's info dialog. */
export type StreamTiming = {
  firstChunkAt?: number
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
  autoMode?: 'speed' | 'accuracy'
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
  const { firstChunkAt, firstAnswerAt, usage, providerCreated } = timing
  const u = usage ?? {}
  const details = u.completion_tokens_details as
    | { reasoning_tokens?: number }
    | undefined
  return {
    total_s: seconds(end - start),
    wait_for_first_byte_s: seconds(firstChunkAt && firstChunkAt - start),
    thinking_s: seconds(
      firstChunkAt && firstAnswerAt && firstAnswerAt - firstChunkAt
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
    // Its name as Settings shows it, e.g. "Claude Haiku 4.5"
    answered_by:
      CHAT_MODELS.find((m) => m.model === request.model)?.label ??
      request.model,
    tab_hidden_at_send: timing.hiddenAtStart,
    tab_hidden_at_first_byte: timing.hiddenAtFirstChunk,
    history_messages: request.messages,
    request_chars: request.chars,
    tools_sent: request.tools,
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    reasoning_tokens: details?.reasoning_tokens,
    provider_queue_s: u.queue_time,
    provider_prompt_s: u.prompt_time,
    provider_generation_s: u.completion_time,
  }
}
