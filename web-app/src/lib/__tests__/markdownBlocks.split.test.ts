import { describe, it, expect } from 'vitest'
import { splitMarkdownBlocks } from '../markdownBlocks'

describe('splitMarkdownBlocks', () => {
  it('splits at blank lines', () => {
    expect(splitMarkdownBlocks('One\n\nTwo\nlines\n\nThree')).toEqual([
      'One',
      'Two\nlines',
      'Three',
    ])
  })
  it('never splits inside code or $$ maths', () => {
    expect(splitMarkdownBlocks('```\na\n\nb\n```\n\n$$\nx\n\ny\n$$')).toEqual([
      '```\na\n\nb\n```',
      '$$\nx\n\ny\n$$',
    ])
  })
  it('keeps an indented continuation with its list item', () => {
    expect(splitMarkdownBlocks('- item\n\n    more of it\n\nAfter')).toEqual([
      '- item\n\n    more of it',
      'After',
    ])
  })
  it('handles empty and trailing blank text', () => {
    expect(splitMarkdownBlocks('')).toEqual([])
    expect(splitMarkdownBlocks('Hi\n\n')).toEqual(['Hi'])
  })
})
