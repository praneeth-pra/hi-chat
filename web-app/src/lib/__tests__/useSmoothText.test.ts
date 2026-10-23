import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSmoothText } from '../useSmoothText'

afterEach(() => vi.useRealTimers())

describe('useSmoothText', () => {
  it('shows finished text at once', () => {
    const { result } = renderHook(() => useSmoothText('Hello there', false))
    expect(result.current).toBe('Hello there')
  })

  it('reveals a streamed burst over a few frames, then all of it', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance'] })
    const { result, rerender } = renderHook(
      ({ text }) => useSmoothText(text, true),
      { initialProps: { text: '' } }
    )
    const burst = 'word '.repeat(40)
    rerender({ text: burst })
    await act(async () => {
      vi.advanceTimersByTime(16)
    })
    expect(result.current.length).toBeGreaterThan(0)
    expect(result.current.length).toBeLessThan(200)
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current).toBe(burst)
  })
})

describe('wholeWords', () => {
  it('never cuts a word in half', async () => {
    const { wholeWords } = await import('../useSmoothText')
    const text = 'Linux commands like grep and awk'
    expect(wholeWords(text, 8)).toBe('Linux commands') // inside "commands": whole
    expect(wholeWords(text, 6)).toBe('Linux ') // at a space
    expect(wholeWords(text, 30)).toBe('Linux commands like grep and ') // "awk" still arriving
    expect(wholeWords(text, text.length)).toBe(text)
    expect(wholeWords('Hel', 2)).toBe('')
  })
})
