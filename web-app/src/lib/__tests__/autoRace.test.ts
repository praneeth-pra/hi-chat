import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  raceAutoAnswers,
  usefulAnswerChunk,
  type AutoAttempt,
} from '../autoRace'
const answer = (text: string) => ({ choices: [{ delta: { content: text } }] })
const role = { choices: [{ delta: { role: 'assistant' } }] }
const reasoning = { choices: [{ delta: { reasoning_content: 'Thinking' } }] }
async function* chunks(...values: unknown[]) {
  yield* values
}
const collect = async (stream: AsyncIterable<unknown>) => {
  const out = []
  for await (const c of stream) out.push(c)
  return out
}
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const tick = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve()
}
afterEach(() => vi.useRealTimers())

describe('useful stream progress', () => {
  it('does not choose role, usage, empty or reasoning-only chunks', () => {
    for (const c of [role, reasoning, { usage: {} }, answer(' '), null])
      expect(usefulAnswerChunk(c)).toBe(false)
    expect(usefulAnswerChunk(answer('Actual answer'))).toBe(true)
    expect(
      usefulAnswerChunk({
        choices: [{ delta: { tool_calls: [{ index: 0 }] } }],
      })
    ).toBe(false)
    expect(
      usefulAnswerChunk({
        choices: [
          { delta: { tool_calls: [{ function: { name: 'lookup' } }] } },
        ],
      })
    ).toBe(true)
  })
})
describe('Auto · Speed', () => {
  it('starts all three, waits for useful content, preserves winner chunks once and cancels losers', async () => {
    const gates = [
      deferred<unknown>(),
      deferred<unknown>(),
      deferred<unknown>(),
    ]
    const controllers: AbortController[] = []
    const started: number[] = []
    const attempts = gates.map(
      (gate, i): AutoAttempt<unknown> => ({
        model: `model-${i}`,
        tier: i === 2 ? 'small' : 'large',
        run: async (controller) => {
          started.push(i)
          controllers[i] = controller
          return (async function* () {
            yield role
            yield reasoning
            yield await gate.promise
            yield answer(`tail-${i}`)
          })()
        },
      })
    )
    const events = vi.fn()
    const result = raceAutoAnswers(
      attempts,
      'speed',
      new AbortController().signal,
      events
    )
    await tick()
    expect(started).toEqual([0, 1, 2])
    gates[2].resolve(answer('fast small'))
    const winner = await result
    expect(winner.winner).toBe(2)
    expect(controllers[0].signal.aborted).toBe(true)
    expect(controllers[1].signal.aborted).toBe(true)
    expect(await collect(winner.stream)).toEqual([
      role,
      reasoning,
      answer('fast small'),
      answer('tail-2'),
    ])
    gates[0].resolve(answer('late large'))
    gates[1].resolve(answer('late other'))
  })
  it('does not let an empty stream or early provider error beat a useful answer', async () => {
    const result = await raceAutoAnswers(
      [
        { model: 'empty', tier: 'large', run: async () => chunks(role) },
        {
          model: 'bad',
          tier: 'large',
          run: async () => {
            throw new Error('rate limited')
          },
        },
        {
          model: 'good',
          tier: 'small',
          run: async () => chunks(answer('Good')),
        },
      ],
      'speed',
      new AbortController().signal
    )
    expect(result.winner).toBe(2)
    expect(await collect(result.stream)).toEqual([answer('Good')])
  })
  it('accepts a tool call and never runs two winning tool streams', async () => {
    const tool = {
      choices: [
        {
          delta: {
            tool_calls: [
              { function: { name: 'get_weather', arguments: '{}' } },
            ],
          },
        },
      ],
    }
    const result = await raceAutoAnswers(
      [
        { model: 'tool', tier: 'large', run: async () => chunks(tool) },
        {
          model: 'text',
          tier: 'small',
          run: async () => chunks(role, answer('other')),
        },
      ],
      'speed',
      new AbortController().signal
    )
    expect(result.winner).toBe(0)
    expect(await collect(result.stream)).toEqual([tool])
  })
})
describe('Auto · Accuracy', () => {
  it('races only the two 120B models while one produces useful content', async () => {
    const small = vi.fn(async () => chunks(answer('Small')))
    const result = await raceAutoAnswers(
      [
        {
          model: 'groq-120b',
          tier: 'large',
          run: async () => chunks(role, reasoning, answer('Groq large')),
        },
        {
          model: 'cerebras-120b',
          tier: 'large',
          run: async () => chunks(answer('Cerebras large')),
        },
        { model: 'groq-20b', tier: 'small', run: small },
      ],
      'accuracy',
      new AbortController().signal
    )
    expect(result.winner).toBe(1)
    expect(small).not.toHaveBeenCalled()
    expect(await collect(result.stream)).toEqual([answer('Cerebras large')])
  })
  it('recovers with 20B only after both large attempts fail', async () => {
    const order: string[] = []
    const result = await raceAutoAnswers(
      [
        {
          model: 'large1',
          tier: 'large',
          run: async () => {
            order.push('large1')
            throw new Error('busy')
          },
        },
        {
          model: 'large2',
          tier: 'large',
          run: async () => {
            order.push('large2')
            return chunks(role)
          },
        },
        {
          model: 'small',
          tier: 'small',
          run: async () => {
            order.push('small')
            return chunks(answer('Recovery'))
          },
        },
      ],
      'accuracy',
      new AbortController().signal
    )
    expect(order).toEqual(['large1', 'large2', 'small'])
    expect(result.winner).toBe(2)
    expect(await collect(result.stream)).toEqual([answer('Recovery')])
  })
  it('uses the available small model if no large provider is configured', async () => {
    const result = await raceAutoAnswers(
      [
        {
          model: 'small',
          tier: 'small',
          run: async () => chunks(answer('Available')),
        },
      ],
      'accuracy',
      new AbortController().signal
    )
    expect(await collect(result.stream)).toEqual([answer('Available')])
  })
})
describe('race safety and deadlines', () => {
  it('times out reasoning-only providers and falls back without an added judge', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let largeController!: AbortController
    const small = vi.fn(async () => chunks(answer('Fallback')))
    const run = raceAutoAnswers(
      [
        {
          model: 'large',
          tier: 'large',
          run: async (c) => {
            largeController = c
            return (async function* () {
              yield reasoning
              await new Promise(() => {})
            })()
          },
        },
        { model: 'small', tier: 'small', run: small },
      ],
      'accuracy',
      controller.signal,
      undefined,
      50
    )
    await tick()
    expect(small).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    const result = await run
    expect(largeController.signal.aborted).toBe(true)
    expect(await collect(result.stream)).toEqual([answer('Fallback')])
    expect(vi.getTimerCount()).toBe(0)
  })
  it('immediately propagates cancellation even if providers ignore abort', async () => {
    const outer = new AbortController()
    const controllers: AbortController[] = []
    const run = raceAutoAnswers(
      [0, 1, 2].map((i) => ({
        model: `${i}`,
        tier: 'large' as const,
        run: async (c: AbortController) => {
          controllers.push(c)
          return (async function* () {
            await new Promise(() => {})
            yield role
          })()
        },
      })),
      'speed',
      outer.signal
    )
    const reject = expect(run).rejects.toMatchObject({ name: 'AbortError' })
    await tick()
    outer.abort()
    await reject
    expect(controllers.every((c) => c.signal.aborted)).toBe(true)
  })
  it('does not emit further answer content after the winner is cancelled', async () => {
    const outer = new AbortController()
    const tail = deferred<unknown>()
    const result = await raceAutoAnswers(
      [
        {
          model: 'a',
          tier: 'large',
          run: async () =>
            (async function* () {
              yield answer('First')
              yield await tail.promise
            })(),
        },
      ],
      'speed',
      outer.signal
    )
    const iterator = result.stream[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toEqual(answer('First'))
    const next = iterator.next()
    outer.abort()
    expect((await next).done).toBe(true)
    tail.resolve(answer('Late'))
  })
  it('returns a useful error when all providers fail and rejects pre-cancelled requests', async () => {
    await expect(
      raceAutoAnswers(
        [{ model: 'bad', tier: 'large', run: async () => chunks() }],
        'speed',
        new AbortController().signal
      )
    ).rejects.toThrow('Auto models could not start an answer')
    const c = new AbortController()
    c.abort()
    await expect(raceAutoAnswers([], 'speed', c.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
