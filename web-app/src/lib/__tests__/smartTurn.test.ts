import { describe, it, expect, vi } from 'vitest'
import { createTurnListener } from '../smartTurn'

const fakeModel = (
  predict: () => Promise<{ probability: number; duration: number }>
) => ({
  load: async () => {},
  push: vi.fn(),
  predict,
  reset: vi.fn(),
})

describe('createTurnListener', () => {
  it('returns null until the model has loaded', async () => {
    let finish: (m: ReturnType<typeof fakeModel>) => void = () => {}
    const turn = createTurnListener(() => new Promise((r) => (finish = r)))
    expect(turn.state()).toBe('loading')
    expect(await turn.check()).toBeNull()
    finish(fakeModel(async () => ({ probability: 0.8, duration: 20 })))
    await turn.ready
    expect(turn.state()).toBe('on')
    expect(await turn.check()).toEqual({ probability: 0.8, ms: 20 })
  })

  it('passes audio to the model', async () => {
    const model = fakeModel(async () => ({ probability: 1, duration: 1 }))
    const turn = createTurnListener(async () => model)
    await turn.ready
    const block = new Float32Array(10)
    turn.push(block)
    expect(model.push).toHaveBeenCalledWith(block)
  })

  it('is unavailable when the model fails to load', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const turn = createTurnListener(async () => {
      throw new Error('blocked')
    })
    await turn.ready
    expect(turn.state()).toBe('unavailable')
    expect(await turn.check()).toBeNull()
  })

  it('gives up on a slow or failed check', async () => {
    const slow = createTurnListener(
      async () => fakeModel(() => new Promise(() => {})),
      20
    )
    await slow.ready
    expect(await slow.check()).toBeNull()
    const broken = createTurnListener(async () =>
      fakeModel(async () => {
        throw new Error('bad')
      })
    )
    await broken.ready
    expect(await broken.check()).toBeNull()
  })
  it('reports a stalled load and ignores a model that arrives after the readiness deadline', async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let finish!: (m: ReturnType<typeof fakeModel>) => void
    const onState = vi.fn()
    const turn = createTurnListener(
      () =>
        new Promise((r) => {
          finish = r
        }),
      500,
      { loadTimeoutMs: 30, onState }
    )
    await vi.advanceTimersByTimeAsync(30)
    await turn.ready
    expect(turn.state()).toBe('unavailable')
    expect(onState).toHaveBeenCalledWith(
      'unavailable',
      expect.stringContaining('readiness budget')
    )
    finish(fakeModel(async () => ({ probability: 1, duration: 1 })))
    await Promise.resolve()
    expect(turn.state()).toBe('unavailable')
    turn.dispose()
    warning.mockRestore()
    vi.useRealTimers()
  })
})
