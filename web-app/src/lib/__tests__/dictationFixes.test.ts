import { describe, it, expect } from 'vitest'
import { applyFixes, parseFixes } from '../dictationFixes'

describe('applyFixes', () => {
  it('fixes known mistakes as whole words, ignoring case', () => {
    expect(applyFixes('by using routers and rollbacks asset controls.')).toBe(
      'by using routers and role-based access controls.'
    )
    expect(applyFixes('a lot of Pinoops or cost')).toBe(
      'a lot of FinOps or cost'
    )
    expect(applyFixes('AWS EC 2, VPC, S 3 buckets')).toBe(
      'AWS EC2, VPC, S3 buckets'
    )
    expect(applyFixes('Is it 2 tire or 3 tire?')).toBe(
      'Is it 2-tier or 3-tier?'
    )
  })

  it('writes CI/CD and S3 however the engines spell them', () => {
    expect(applyFixes('Have you used CSCD or CI CD or CACD?')).toBe(
      'Have you used CI/CD or CI/CD or CI/CD?'
    )
    expect(applyFixes('a CICD pipeline with an S three bucket')).toBe(
      'a CI/CD pipeline with an S3 bucket'
    )
    expect(applyFixes('CI/CD stays')).toBe('CI/CD stays')
  })

  it('leaves other words alone', () => {
    expect(applyFixes('the S3 bucket and a tire shop')).toBe(
      'the S3 bucket and a tire shop'
    )
    expect(applyFixes('kubectl rollbacks')).toBe('kubectl rollbacks')
  })

  it('reads the list format, skipping comments', () => {
    const fixes = parseFixes('# note\nfoo bar => Baz\nbad line\n')
    expect(fixes).toHaveLength(1)
    expect(applyFixes('a Foo, bar b', fixes)).toBe('a Baz b')
  })
})
