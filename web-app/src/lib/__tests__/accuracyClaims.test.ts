import { describe, expect, it } from 'vitest'
import {
  groundAccuracyMessages,
  parseAccuracyVerdict,
  type WebEvidence,
} from '../accuracyReview'

const evidence: WebEvidence = {
  status: 'ready',
  sources: [
    {
      url: 'https://robotframework.org/docs',
      title: 'Robot Framework',
      text: 'User keywords can be created in resource files. Custom libraries can be implemented in Python.',
    },
  ],
}
const invented =
  'Assert All is a built-in keyword and returns the first failing expression.'
const qualified =
  'I cannot confirm assert_all as a built-in keyword from these excerpts. Which library defines it?'
const uncertainReview = {
  verdict: 'uncertain',
  answer: qualified,
  unsupportedClaims: [invented],
  claims: [{ text: qualified, support: 'qualified' }],
}
const sourceReview = {
  verdict: 'approved',
  unsupportedClaims: [],
  claims: [
    {
      text: 'Custom libraries can be implemented in Python.',
      support: 'source',
      sourceId: 1,
      quote: 'Custom libraries can be implemented in Python.',
    },
  ],
}
const parse = (review: unknown, answer = invented) =>
  parseAccuracyVerdict(JSON.stringify(review), answer, evidence, [])

describe('Accuracy claim evidence validation', () => {
  it('accepts visible claim wording when Markdown marks a keyword or bold text', () => {
    const answer =
      '- **I cannot confirm** `assert_all` as a standard keyword. Which library defines it?'
    const review = {
      verdict: 'uncertain',
      answer,
      unsupportedClaims: [],
      claims: [
        {
          text: 'I cannot confirm assert_all as a standard keyword.',
          support: 'qualified',
        },
      ],
    }
    expect(parse(review).answer).toBe(answer)
  })
  it('preserves underscore identifiers and literal code operators when matching claims', () => {
    for (const [answer, text] of [
      ['Use `assert_all`.', 'Use assertall.'],
      ['Use `a ** b`.', 'Use a b.'],
    ]) {
      expect(() =>
        parse({
          verdict: 'uncertain',
          answer,
          unsupportedClaims: [],
          claims: [{ text, support: 'qualified' }],
        })
      ).toThrow('Invalid claim')
    }
  })
  it('does not accept a bare approval of the invented Assert All claim', () => {
    expect(() => parse({ verdict: 'approved' })).toThrow('Missing claim review')
  })
  it('removes the unsupported built-in behavior and permits an explicit qualification', () => {
    const checked = parse(uncertainReview)
    expect(checked.answer).toBe(qualified)
    expect(checked.audit).toMatchObject({
      claimCount: 1,
      qualifiedClaimCount: 1,
      unsupportedClaimCount: 1,
    })
  })
  it('rejects approval when the reviewer itself found an unsupported claim', () => {
    expect(() =>
      parse({
        ...uncertainReview,
        verdict: 'approved',
        claims: [{ text: invented, support: 'qualified' }],
      })
    ).toThrow('cannot be approved')
  })
  it('accepts a factual claim with a real source excerpt, allowing whitespace differences', () => {
    const review = {
      ...sourceReview,
      claims: [
        {
          ...sourceReview.claims[0],
          quote: 'Custom libraries can be\nimplemented in Python.',
        },
      ],
    }
    expect(
      parse(review, sourceReview.claims[0].text).audit.sourceClaimCount
    ).toBe(1)
  })
  it('rejects nonexistent sources and fabricated quotations', () => {
    for (const patch of [
      { sourceId: 99 },
      { sourceId: 1.5 },
      { quote: 'Assert All is built in.' },
    ]) {
      expect(() =>
        parse(
          {
            ...sourceReview,
            claims: [{ ...sourceReview.claims[0], ...patch }],
          },
          sourceReview.claims[0].text
        )
      ).toThrow('Invalid source evidence')
    }
  })
  it('checks newly revised claims against the final answer rather than just the draft', () => {
    expect(() =>
      parse({
        ...sourceReview,
        verdict: 'revised',
        answer: 'An unrelated answer',
      })
    ).toThrow('Invalid claim')
  })
  it('rejects a revision that reports an unsupported assertion but keeps it as a sourced fact', () => {
    expect(() =>
      parse({
        verdict: 'revised',
        answer: invented,
        unsupportedClaims: [invented],
        claims: [
          {
            text: invented,
            support: 'source',
            sourceId: 1,
            quote: evidence.sources[0].text,
          },
        ],
      })
    ).toThrow('retained without qualification')
  })
  it('cannot use a previous assistant answer as evidence for the user’s experience', () => {
    const review = {
      verdict: 'approved',
      unsupportedClaims: [],
      claims: [
        { text: 'I built this.', support: 'context', quote: 'I built this.' },
      ],
    }
    expect(() =>
      parseAccuracyVerdict(JSON.stringify(review), 'I built this.', evidence, [
        { role: 'assistant', content: 'I built this.' },
      ])
    ).toThrow('Invalid user context evidence')
    expect(
      parseAccuracyVerdict(JSON.stringify(review), 'I built this.', evidence, [
        { role: 'user', content: 'I built this.' },
      ]).verdict
    ).toBe('approved')
  })
  it('bounds claim lists and rejects empty or unknown claim support', () => {
    for (const claims of [
      [],
      Array(41).fill(sourceReview.claims[0]),
      [{ text: invented, support: 'trust-me' }],
    ]) {
      expect(() =>
        parse({ verdict: 'approved', claims, unsupportedClaims: [] })
      ).toThrow()
    }
  })
  it('supplies numbered evidence without mutating the conversation or elevating excerpts into system instructions', () => {
    const messages = [{ role: 'user' as const, content: 'What is assert_all?' }]
    const grounded = groundAccuracyMessages(messages, evidence)
    expect(messages).toHaveLength(1)
    expect(
      grounded
        .filter((message) => message.role === 'system')
        .some((message) =>
          String(message.content).includes(evidence.sources[0].text)
        )
    ).toBe(false)
    const reference = JSON.parse(String(grounded.at(-1)?.content))
    expect(reference.sources[0]).toMatchObject({
      sourceId: 1,
      text: evidence.sources[0].text,
    })
  })
})
