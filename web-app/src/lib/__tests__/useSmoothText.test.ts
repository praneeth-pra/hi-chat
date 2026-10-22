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
    const burst = 'x'.repeat(200)
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
