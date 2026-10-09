import { describe, it, expect } from 'vitest'
import { isCodingCue } from '../codingCue'

describe('isCodingCue', () => {
  it('spots the start of the hands-on part', () => {
    expect(isCodingCue('Can you share your screen?')).toBe(true)
    expect(isCodingCue('Can you write in the notepad?')).toBe(true)
    expect(isCodingCue('Open an online compiler.')).toBe(true)
    expect(isCodingCue('Write that command.')).toBe(true)
    expect(isCodingCue('Can you write some query?')).toBe(true)
    expect(isCodingCue('Can you open this notepad?')).toBe(true)
    expect(isCodingCue('In Mac, you have TextEdit, I guess, right?')).toBe(true)
    expect(
      isCodingCue('Just write a simple code for using REST Assured.')
    ).toBe(true)
    expect(
      isCodingCue('Can you write a simple query like third highest salary?')
    ).toBe(true)
  })
  it('ignores ordinary questions', () => {
    expect(isCodingCue('What is ramp up in JMeter?')).toBe(false)
    expect(isCodingCue('How do you extract the token?')).toBe(false)
    expect(isCodingCue('Which IDE do you use?')).toBe(false)
  })
})
