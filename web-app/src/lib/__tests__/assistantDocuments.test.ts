import { describe, expect, it } from 'vitest'
import {
  estimateTokens,
  extractDocumentText,
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
