import { describe, expect, it } from 'vitest'
import { withAnswerDetail } from '../answerDetail'

describe('withAnswerDetail', () => {
  it('allows a structure layout for architecture questions but keeps the no-table rule', () => {
    const rule = withAnswerDetail(undefined)
    expect(rule).toContain('src/test/java')
    expect(rule).toContain('Strictly no tabular answers')
  })
})
