import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStreamFlushScheduler } from '../streamFlushScheduler'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe('stream rendering', () => {
  it('shows first useful text immediately even with a pending animation frame', () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    let text = 'reasoning'
    const seen: string[] = []
    const scheduler = createStreamFlushScheduler(
      () => seen.push(text),
      new AbortController().signal
    )
    scheduler.schedule()
    text = 'first answer'
    scheduler.schedule(true)
    expect(seen).toEqual(['first answer'])
    vi.advanceTimersByTime(100)
    expect(seen).toEqual(['first answer'])
    scheduler.dispose()
  })
  it('flushes the latest tokens when the browser never delivers an animation frame', () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    let text = 'a'
    const seen: string[] = []
    const scheduler = createStreamFlushScheduler(
      () => seen.push(text),
      new AbortController().signal
    )
    scheduler.schedule()
    text = 'abc'
    scheduler.schedule()
    vi.advanceTimersByTime(40)
    expect(seen).toEqual(['abc'])
    scheduler.dispose()
  })
  it('does not duplicate a frame flush or update after Stop', () => {
    vi.useFakeTimers()
    let frame!: () => void
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback) => {
        frame = callback
        return 1
      })
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const flush = vi.fn()
    const stop = new AbortController()
    const scheduler = createStreamFlushScheduler(flush, stop.signal)
    scheduler.schedule()
    frame()
    vi.advanceTimersByTime(40)
    expect(flush).toHaveBeenCalledTimes(1)
    scheduler.schedule()
    stop.abort()
    frame()
    vi.advanceTimersByTime(40)
    scheduler.schedule(true)
    expect(flush).toHaveBeenCalledTimes(1)
  })
})
