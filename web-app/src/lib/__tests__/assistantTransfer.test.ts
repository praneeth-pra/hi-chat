import { describe, it, expect, vi } from 'vitest'
import {
  exportAssistants,
  exportFileName,
  importAssistants,
  parseAssistants,
} from '../assistantTransfer'

describe('assistant export/import', () => {
  it('names the file by date', () => {
    expect(exportFileName(new Date('2026-10-06T12:00:00Z'))).toBe(
      'assistants-2026-10-06.json'
    )
  })

  it('reads back what it exports', () => {
    const list = [{ id: 'a', name: 'A', instructions: 'x', keyterms: ['k'] }]
    expect(parseAssistants(exportAssistants(list))).toEqual(list)
  })

  it('accepts a single assistant and skips broken entries', () => {
    expect(parseAssistants('{"id":"a","name":"A"}')).toEqual([
      { id: 'a', name: 'A' },
    ])
    expect(
      parseAssistants('[{"id":"a","name":"A"},{"name":"no id"},null,3]')
    ).toEqual([{ id: 'a', name: 'A' }])
    expect(() => parseAssistants('not json')).toThrow()
  })

  it('adds new assistants and replaces existing ones', () => {
    const add = vi.fn()
    const update = vi.fn()
    const result = importAssistants(
      [
        { id: 'a', name: 'A2' },
        { id: 'c', name: 'C' },
      ],
      [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      add,
      update
    )
    expect(result).toEqual({ added: 1, updated: 1 })
    expect(update).toHaveBeenCalledWith({ id: 'a', name: 'A2' })
    expect(add).toHaveBeenCalledWith({ id: 'c', name: 'C' })
  })
})
