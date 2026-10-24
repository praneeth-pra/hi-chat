import { describe, expect, it } from 'vitest'
import { CODING_ANSWER_RULE, withCodingRule } from '../codingAnswer'

describe('codingAnswer', () => {
  it('adds the short-code rule every time, so the instructions never change', () => {
    expect(withCodingRule('Answer as P.')).toBe(
      `Answer as P.\n\n${CODING_ANSWER_RULE}`
    )
    expect(withCodingRule(undefined)).toBe(CODING_ANSWER_RULE)
  })

  it('applies only when a question asks for code', () => {
    expect(CODING_ANSWER_RULE).toMatch(
      /^If this question asks you to write code/
    )
  })

  it('asks for comment-free code with only a short explanation', () => {
    expect(CODING_ANSWER_RULE).toContain('no comments of any kind')
    expect(CODING_ANSWER_RULE).toContain('at most 2 or 3 short bullets')
  })
})
