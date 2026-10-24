import { describe, expect, it } from 'vitest'
import { formatSeconds, networkLevel } from '../lastReply'

describe('network meter', () => {
  it('shows milliseconds under a second, seconds above', () => {
    expect(formatSeconds(0.312)).toBe('312 ms')
    expect(formatSeconds(1.26)).toBe('1.3 s')
  })
  it('is green under 1 s, amber under 1.5 s, red from 1.5 s', () => {
    expect(networkLevel(0.31)).toBe('light')
    expect(networkLevel(0.99)).toBe('light')
    expect(networkLevel(1.2)).toBe('medium')
    expect(networkLevel(1.5)).toBe('heavy')
    expect(networkLevel(2.4)).toBe('heavy')
  })
})
