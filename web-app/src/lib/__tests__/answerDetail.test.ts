import { describe, expect, it } from 'vitest'
import { withAnswerDetail } from '../answerDetail'

describe('withAnswerDetail', () => {
  it('allows a structure layout for architecture questions but keeps the no-table rule', () => {
    const rule = withAnswerDetail(undefined)
    expect(rule).toContain('src/test/java')
    expect(rule).toContain('always include one short diagram')
    expect(rule).toContain('```flow')
    expect(rule).toContain('```tree')
    expect(rule).toContain('Strictly no tabular answers')
  })

  it('keeps each bullet to about two lines', () => {
    expect(withAnswerDetail(undefined)).toContain('fits in about two lines')
  })

  it('asks every model for medium-length answers to open questions', () => {
    expect(withAnswerDetail(undefined)).toContain('roughly 100 to 200 words')
  })
})
