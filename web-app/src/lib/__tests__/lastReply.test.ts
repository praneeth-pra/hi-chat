import { describe, expect, it } from 'vitest'
import { formatSeconds, networkLevel } from '../lastReply'

describe('network meter', () => {
  it('shows milliseconds under a second, seconds above', () => {
    expect(formatSeconds(0.312)).toBe('312 ms')
    expect(formatSeconds(1.26)).toBe('1.3 s')
  })
  it('is green under 0.5 s, amber under 1 s, red from 1 s', () => {
    expect(networkLevel(0.31)).toBe('light')
    expect(networkLevel(0.7)).toBe('medium')
    expect(networkLevel(1.2)).toBe('heavy')
  })
})
