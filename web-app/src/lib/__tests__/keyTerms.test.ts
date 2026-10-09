import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  activeKeyTerms,
  cleanKeyTerms,
  extractKeyTerms,
  parseKeyTerms,
  setDictionary,
} from '../keyTerms'

describe('keyTerms', () => {
  afterEach(() => localStorage.clear())

  it('splits lines and commas, drops duplicates and over-long terms', () => {
    expect(
      parseKeyTerms(
        `VPC, Subnet, NAT Gateway\nnat gateway\n- Kubernetes\n${'x'.repeat(51)}`
      )
    ).toEqual(['VPC', 'Subnet', 'NAT Gateway', 'Kubernetes'])
  })

  it('keeps at most 100 terms', () => {
    const many = Array.from({ length: 150 }, (_, i) => `term${i}`)
    expect(cleanKeyTerms(many)).toHaveLength(100)
  })

  it("uses the assistant's terms, else the start of the dictionary", () => {
    setDictionary(Array.from({ length: 300 }, (_, i) => `word${i}`).join('\n'))
    expect(activeKeyTerms(['EKS'])).toEqual(['EKS'])
    const fallback = activeKeyTerms()
    expect(fallback).toHaveLength(100)
    expect(fallback[0]).toBe('word0')
  })

  it('asks Groq 20b, passing the dictionary', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'VPC\nNAT gateway\n' } }],
      }),
    }))
    const terms = await extractKeyTerms(
      'Our network uses a VPC with a NAT gateway.',
      { apiKey: 'g', baseUrl: 'http://groq.test/v1' },
      ['NAT gateway', 'Terraform'],
      fetchMock as unknown as typeof fetch
    )
    expect(terms).toEqual(['VPC', 'NAT gateway'])
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body
    )
    expect(body.model).toBe('openai/gpt-oss-20b')
    expect(body.messages[1].content).toContain('Dictionary:\nNAT gateway')
  })
})
