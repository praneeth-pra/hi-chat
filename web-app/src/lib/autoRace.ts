/** Auto selects one useful stream and never combines answers from different models. */
export type AutoMode = 'speed' | 'accuracy' | 'instant'
export const AUTO_MODES: {
  value: AutoMode
  label: string
  description: string
}[] = [
  {
    value: 'speed',
    label: 'Auto · Speed',
    description: 'Fastest answer from Groq 20B, Groq 120B or Cerebras 120B.',
  },
  {
    value: 'accuracy',
    label: 'Auto · Accuracy',
    description:
      '120B draft, required Exa web search, and correctness review before showing the answer.',
  },
  {
    value: 'instant',
    label: 'Auto · Instant',
    description:
      'Aims to start the answer within 1 s: Cerebras 120B thinks as much as each question needs, Groq steps in only if it is slow.',
  },
]
/**
 * Instant starts the first model alone (Cerebras) and the others only when it
 * fails, sends nothing within HEDGE_FIRST_CHUNK_MS, or has no answer word
 * within HEDGE_ANSWER_MS. Cerebras' first byte is ~0.36 s (Artificial
 * Analysis), so this rarely costs a second request.
 */
export const HEDGE_FIRST_CHUNK_MS = 700
export const HEDGE_ANSWER_MS = 2000
export const AUTO_ANSWER_TIMEOUT_MS = 8000
const MAX_BUFFERED_CHUNKS = 4096
export type AutoAttempt<T> = {
  model: string
  tier: 'large' | 'small'
  run: (controller: AbortController) => Promise<AsyncIterable<T>>
}

/** Role/usage/reasoning deltas alone cannot win. A tool request is useful progress. */
export function usefulAnswerChunk(chunk: unknown): boolean {
  const choices = (
    chunk as {
      choices?: {
        delta?: {
          content?: unknown
          tool_calls?: { function?: { name?: string; arguments?: string } }[]
        }
        message?: { content?: unknown; tool_calls?: unknown[] }
      }[]
    } | null
  )?.choices
  return !!choices?.some(
    ({ delta, message }) =>
      (typeof delta?.content === 'string' && delta.content.trim().length > 0) ||
      delta?.tool_calls?.some(
        (call) => !!call.function?.name || !!call.function?.arguments
      ) ||
      (typeof message?.content === 'string' &&
        message.content.trim().length > 0) ||
      !!message?.tool_calls?.length
  )
}

/** ES2020-compatible first-success race; a failed provider cannot win. */
function firstSuccessful<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let remaining = promises.length
    if (!remaining) {
      reject(new Error('No attempts'))
      return
    }
    for (const promise of promises)
      promise.then(resolve, () => {
        remaining -= 1
        if (!remaining) reject(new Error('All attempts failed'))
      })
  })
}

export async function raceAutoAnswers<T>(
  attempts: AutoAttempt<T>[],
  mode: AutoMode,
  outer: AbortSignal,
  onEvent?: (
    index: number,
    event:
      | 'started'
      | 'first-chunk'
      | 'answer-ready'
      | 'tool-ready'
      | 'failed'
      | 'winner'
      | 'cancelled',
    reason?: string
  ) => void,
  timeoutMs = AUTO_ANSWER_TIMEOUT_MS
): Promise<{ stream: AsyncIterable<T>; winner: number }> {
  if (outer.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!attempts.length) throw new Error('No Auto provider is configured')
  type Running = {
    controller: AbortController
    iterator?: AsyncIterator<T>
    ready: Promise<{ index: number; buffered: T[] }>
    cleanup: () => void
    rejectAbort: (reason: unknown) => void
    abortWait: Promise<never>
  }
  const running = new Map<number, Running>()
  const sentSomething = new Set<number>()
  const start = (index: number) => {
    const controller = new AbortController()
    let rejectAbort!: (reason: unknown) => void
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = reject
    })
    const stop = () => {
      controller.abort()
      rejectAbort(new DOMException('Aborted', 'AbortError'))
    }
    outer.addEventListener('abort', stop, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      clearTimeout(timer)
      outer.removeEventListener('abort', stop)
    }
    const run: Running = {
      controller,
      cleanup,
      rejectAbort,
      abortWait: cancelled,
      ready: Promise.resolve({ index, buffered: [] }),
    }
    running.set(index, run)
    onEvent?.(index, 'started')
    const ready = (async () => {
      const stream = await attempts[index].run(controller)
      run.iterator = stream[Symbol.asyncIterator]()
      const buffered: T[] = []
      while (!controller.signal.aborted) {
        const next = await run.iterator.next()
        if (next.done)
          throw new Error('Stream ended without an answer or tool request')
        if ((next.value as { error?: unknown } | null)?.error)
          throw new Error('Provider returned a stream error')
        if (!buffered.length) {
          sentSomething.add(index)
          onEvent?.(index, 'first-chunk')
        }
        buffered.push(next.value)
        if (usefulAnswerChunk(next.value)) {
          const choices = (
            next.value as {
              choices?: {
                delta?: { content?: unknown }
                message?: { content?: unknown }
              }[]
            }
          ).choices
          const hasAnswer = choices?.some((choice) => {
            const content = choice.delta?.content ?? choice.message?.content
            return typeof content === 'string' && content.trim().length > 0
          })
          onEvent?.(index, hasAnswer ? 'answer-ready' : 'tool-ready')
          return { index, buffered }
        }
        if (buffered.length >= MAX_BUFFERED_CHUNKS)
          throw new Error('Stream produced too many chunks without an answer')
      }
      throw new DOMException('Aborted', 'AbortError')
    })()
    // Providers may ignore cancellation; stale completions must still be harmless.
    ready.catch(() => {})
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('No useful answer within the Auto deadline')),
        timeoutMs
      )
    })
    run.ready = Promise.race([ready, timeout, cancelled])
      .then((result) => {
        clearTimeout(timer)
        return result
      })
      .catch((error: unknown) => {
        controller.abort()
        cleanup()
        onEvent?.(
          index,
          'failed',
          error instanceof Error ? error.message : String(error)
        )
        throw error
      })
    run.ready.catch(() => {})
    return run.ready
  }
  const cancel = (index: number) => {
    const run = running.get(index)
    if (!run) return
    run.controller.abort()
    run.cleanup()
    run.rejectAbort(new DOMException('Aborted', 'AbortError'))
    // Do not await return(): an uncooperative provider may still have next() pending.
    Promise.resolve(run.iterator?.return?.()).catch(() => {})
    onEvent?.(index, 'cancelled')
  }
  const serve = (winner: { index: number; buffered: T[] }) => {
    if (outer.aborted) throw new DOMException('Aborted', 'AbortError')
    for (const index of running.keys())
      if (index !== winner.index) cancel(index)
    const run = running.get(winner.index)!
    onEvent?.(winner.index, 'winner')
    const stream = (async function* () {
      try {
        for (const chunk of winner.buffered) {
          if (outer.aborted || run.controller.signal.aborted) return
          yield chunk
        }
        while (!outer.aborted && !run.controller.signal.aborted) {
          const next = await Promise.race([run.iterator!.next(), run.abortWait])
          if (next.done || outer.aborted || run.controller.signal.aborted)
            return
          yield next.value
        }
      } catch (error) {
        if (!outer.aborted) throw error
      } finally {
        run.controller.abort()
        run.cleanup()
        Promise.resolve(run.iterator?.return?.()).catch(() => {})
      }
    })()
    return { stream, winner: winner.index }
  }
  // Instant: the first attempt alone, the rest only when it is slow or fails
  const hedged = () =>
    new Promise<{ index: number; buffered: T[] }>((resolve, reject) => {
      const backups = attempts.map((_, i) => i).slice(1)
      let started = 0
      let failed = 0
      let backedUp = !backups.length
      const timers: ReturnType<typeof setTimeout>[] = []
      const settle = () => timers.forEach(clearTimeout)
      const add = (index: number) => {
        started += 1
        start(index).then(
          (winner) => {
            settle()
            resolve(winner)
          },
          () => {
            failed += 1
            if (index === 0) backUp()
            if (failed === started && (backedUp || outer.aborted)) {
              settle()
              reject(new Error('All attempts failed'))
            }
          }
        )
      }
      const backUp = () => {
        if (backedUp || outer.aborted) return
        backedUp = true
        backups.forEach(add)
      }
      add(0)
      timers.push(
        setTimeout(() => {
          if (!sentSomething.has(0)) backUp()
        }, HEDGE_FIRST_CHUNK_MS),
        setTimeout(backUp, HEDGE_ANSWER_MS)
      )
    })
  const groups =
    mode === 'speed'
      ? [attempts.map((_, i) => i)]
      : [
          attempts.flatMap((a, i) => (a.tier === 'large' ? [i] : [])),
          attempts.flatMap((a, i) => (a.tier === 'small' ? [i] : [])),
        ]
  try {
    if (mode === 'instant') return serve(await hedged())
    for (const group of groups) {
      if (!group.length) continue
      try {
        return serve(await firstSuccessful(group.map(start)))
      } catch (error) {
        if (outer.aborted) throw new DOMException('Aborted', 'AbortError')
        if (group === groups.at(-1)) throw error
      }
    }
    throw new Error('No Auto model produced an answer')
  } catch (error) {
    for (const index of running.keys()) cancel(index)
    if (outer.aborted) throw new DOMException('Aborted', 'AbortError')
    throw new Error(
      'Auto models could not start an answer; retry or select a model manually'
    )
  }
}
