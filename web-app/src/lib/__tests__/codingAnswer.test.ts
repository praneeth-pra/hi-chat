import { describe, expect, it } from 'vitest'
import {
  CODING_ANSWER_RULE,
  asksForCode,
  withCodingRule,
} from '../codingAnswer'

describe('codingAnswer', () => {
  it('spots questions that ask for code', () => {
    expect(asksForCode('Can you write a Jenkinsfile for this?')).toBe(true)
    expect(asksForCode('Tell me some commands to get pod status')).toBe(true)
    expect(asksForCode('Write a SQL query for the top 5 salaries')).toBe(true)
    expect(asksForCode('How do you debug issues in AWS?')).toBe(false)
  })

  it('adds the short-code rule only when it applies', () => {
    expect(withCodingRule('Answer as P.', 'What is a VPC?')).toBe(
      'Answer as P.'
    )
    expect(withCodingRule('Answer as P.', 'Write a bash script')).toBe(
      `Answer as P.\n\n${CODING_ANSWER_RULE}`
    )
    expect(withCodingRule(undefined, 'Write code to reverse a string')).toBe(
      CODING_ANSWER_RULE
    )
  })
})
