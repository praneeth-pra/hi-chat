import { describe, expect, it } from 'vitest'
import {
  estimateTokens,
  extractDocumentText,
  relevantDocuments,
  withDocuments,
  withoutDocuments,
} from '../assistantDocuments'

describe('withDocuments', () => {
  it('leaves instructions alone when there are no documents', () => {
    expect(withDocuments('Be brief.', undefined)).toBe('Be brief.')
    expect(withDocuments('Be brief.', [{ name: 'empty.txt', text: ' ' }])).toBe(
      'Be brief.'
    )
  })

  it('appends each document under its name', () => {
    const out = withDocuments('Be brief.', [
      { name: 'resume.pdf', text: 'Five years of Azure.' },
      { name: 'notes.md', text: 'AKS upgrades' },
    ])
    expect(out).toContain('Be brief.\n\n## Reference documents')
    expect(out).toContain('### resume.pdf\n\nFive years of Azure.')
    expect(out).toContain('### notes.md\n\nAKS upgrades')
  })

  it('works without instructions', () => {
    expect(withDocuments('', [{ name: 'a.txt', text: 'hi' }])).toMatch(
      /^## Reference documents/
    )
  })
})

describe('withoutDocuments', () => {
  it('drops the document text and keeps the rest', () => {
    const a = { id: 'x', name: 'X', documents: [{ name: 'a', text: 'b' }] }
    expect(withoutDocuments(a)).toEqual({ id: 'x', name: 'X' })
    expect(a.documents).toHaveLength(1)
  })

  it('passes through null and assistants without documents', () => {
    const b = { id: 'y' }
    expect(withoutDocuments(b)).toBe(b)
    expect(withoutDocuments(null)).toBeNull()
  })
})

describe('extractDocumentText', () => {
  it('reads text files and tidies blank lines', async () => {
    const content = 'line one  \r\n\r\n\r\n\r\nline two'
    // jsdom's File has no text(), unlike browsers
    const file = Object.assign(new File([content], 'a.md'), {
      text: async () => content,
    })
    expect(await extractDocumentText(file)).toBe('line one\n\nline two')
  })

  it('rejects old .doc files with a hint', async () => {
    await expect(
      extractDocumentText(new File(['x'], 'old.doc'))
    ).rejects.toThrow('.docx')
  })
})

describe('estimateTokens', () => {
  it('counts about four characters per token', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100)
  })
})

describe('relevantDocuments', () => {
  const filler = (topic: string, n: number) =>
    Array.from(
      { length: n },
      (_, i) => `${topic} note ${i}: routine details about ${topic} work.`
    ).join('\n')
  // About 65,000 tokens, like the documents that made answers slow
  const big = [
    {
      name: 'aws.md',
      text: [
        filler('networking', 1500),
        'EBS (Elastic Block Store) gives EC2 instances persistent block volumes.',
        filler('billing', 1500),
        'ECS runs Docker containers on EC2 or Fargate.',
        filler('logging', 1500),
      ].join('\n'),
    },
    { name: 'resume.pdf', text: filler('kubernetes', 1500) },
  ]

  it('sends small documents whole', () => {
    const docs = [{ name: 'a.txt', text: 'short' }]
    expect(relevantDocuments(docs, 'anything')).toBe(docs)
    expect(relevantDocuments(undefined, 'anything')).toBeUndefined()
  })

  it('keeps large documents within the budget and finds the matching passage', () => {
    const out = relevantDocuments(big, 'what is ebs')!
    const text = out.map((d) => d.text).join('\n')
    expect(text).toContain('EBS (Elastic Block Store)')
    expect(Math.ceil(text.length / 4)).toBeLessThanOrEqual(5_000)
    expect(out.every((d) => ['aws.md', 'resume.pdf'].includes(d.name))).toBe(
      true
    )
  })

  it('uses the earlier question for a follow-up', () => {
    const text = relevantDocuments(big, 'tell me more what is ecs')!
      .map((d) => d.text)
      .join('\n')
    expect(text).toContain('ECS runs Docker containers')
  })

  it('sends nothing when no word matches', () => {
    expect(relevantDocuments(big, 'hi there')).toEqual([])
  })

  it('cuts a document with no line breaks into passages', () => {
    const one = [{ name: 'page.pdf', text: `${'word '.repeat(40_000)}ebs volumes` }]
    const text = relevantDocuments(one, 'ebs')![0].text
    expect(text).toContain('ebs volumes')
    expect(text.length).toBeLessThan(5_000)
  })

  it('is quick on large documents', () => {
    const t = performance.now()
    relevantDocuments(big, 'what is ebs')
    expect(performance.now() - t).toBeLessThan(200)
  })
})
