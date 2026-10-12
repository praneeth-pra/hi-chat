import { describe, expect, it } from 'vitest'
import { nextRevealLength } from '../smoothText'

describe('nextRevealLength', () => {
  const text =
    'Flaky tests usually come from timing, shared data or brittle locators. '.repeat(
      20
    )

  it('shows the opening sentence straight away', () => {
    expect(nextRevealLength(text, 0)).toBe(
      'Flaky tests usually come from timing, shared data or brittle locators.'
        .length
    )
    expect(nextRevealLength('Short answer.', 0)).toBe(13)
  })

  it('reveals 30% of the hidden text per frame, ending on a word', () => {
    const next = nextRevealLength(text, 100)
    expect(next).toBeGreaterThanOrEqual(
      100 + Math.ceil((text.length - 100) * 0.3)
    )
    expect(next === text.length || /\s/.test(text[next])).toBe(true)
  })

  it('catches up with any burst within about 15 frames', () => {
    let shown = 10
    let frames = 0
    while (shown < text.length) {
      shown = nextRevealLength(text, shown)
      frames++
    }
    expect(frames).toBeLessThanOrEqual(16)
  })

  it('never goes past the text', () => {
    expect(nextRevealLength('abc', 2)).toBe(3)
    expect(nextRevealLength(text, text.length - 20)).toBe(text.length)
    expect(nextRevealLength('abc', 5)).toBe(3)
  })
})
