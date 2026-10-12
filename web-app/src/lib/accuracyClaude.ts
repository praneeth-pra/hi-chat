import { streamClaude, type ClaudeChunk } from './claudeChat'
import type { AccuracyReview, WebEvidence } from './accuracyReview'

export const CLAUDE_ANSWER_MODEL = 'claude-sonnet-5-5'
/** Claude's first words must arrive within this, or Accuracy falls back to gpt-oss. */
export const CLAUDE_FIRST_TOKEN_MS = 4000

/**
 * Auto · Accuracy with a Claude provider: Claude Sonnet 5.5 writes the answer
 * from the same grounded messages (web sources or the user's profile) and it
 * streams straight to the chat, with no separate audit. Resolves once the
 * first words arrive; throws on an error or no words within
 * CLAUDE_FIRST_TOKEN_MS so the caller can use the gpt-oss draft and review.
 * `onDone` gets the review with the full answer time once the stream ends.
 */
export async function claudeAccuracyAnswer(opts: {
  apiKey: string
  baseUrl?: string
  messages: { role: string; content?: unknown }[]
  evidence: WebEvidence
  signal: AbortSignal
  requestStart: number
  onDone: (review: AccuracyReview) => void
  firstTokenMs?: number
}): Promise<{
  completion: AsyncIterable<ClaudeChunk>
  review: AccuracyReview
}> {
  const controller = new AbortController()
  const link = () => controller.abort(opts.signal.reason)
  if (opts.signal.aborted) throw opts.signal.reason
  opts.signal.addEventListener('abort', link, { once: true })
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Claude answer timed out')),
      opts.firstTokenMs ?? CLAUDE_FIRST_TOKEN_MS
    )
  })
  let iterator: AsyncIterator<ClaudeChunk> | undefined
  let first: IteratorResult<ClaudeChunk>
  try {
    first = await Promise.race([
      (async () => {
        const stream = await streamClaude({
          apiKey: opts.apiKey,
          baseUrl: opts.baseUrl,
          model: CLAUDE_ANSWER_MODEL,
          messages: opts.messages,
          signal: controller.signal,
          fast: true,
        })
        iterator = stream[Symbol.asyncIterator]()
        return iterator.next()
      })(),
      timeout,
    ])
    if (first.done || !first.value.choices[0]?.delta.content)
      throw new Error('Claude answer was empty')
  } catch (error) {
    controller.abort(error)
    opts.signal.removeEventListener('abort', link)
    throw opts.signal.aborted ? opts.signal.reason : error
  } finally {
    clearTimeout(timer)
  }
  const review: AccuracyReview = {
    verdict: 'direct',
    verifier: 'Claude Sonnet 5.5',
    model: CLAUDE_ANSWER_MODEL,
    webStatus: opts.evidence.status,
    sources: opts.evidence.sources.map((source) => ({ ...source, text: '' })),
    searchMs: opts.evidence.searchMs,
    reviewMs: 0,
    draftMs: 0,
    firstTokenMs: Date.now() - opts.requestStart,
  }
  const rest = iterator!
  const completion = (async function* () {
    try {
      yield first.value
      for (;;) {
        const next = await rest.next()
        if (next.done) break
        yield next.value
      }
      review.draftMs = Date.now() - started
      opts.onDone(review)
    } finally {
      opts.signal.removeEventListener('abort', link)
      controller.abort(new Error('Claude answer finished'))
    }
  })()
  return { completion, review }
}
