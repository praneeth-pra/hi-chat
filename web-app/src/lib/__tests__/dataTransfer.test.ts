import { describe, expect, it } from 'vitest'
import {
  DATA_FILE_KIND,
  dataFileName,
  importData,
  parseDataFile,
  readLocalStorage,
} from '../dataTransfer'

describe('data transfer', () => {
  it('reads every localStorage entry', () => {
    localStorage.clear()
    localStorage.setItem('a', '1')
    localStorage.setItem('model-provider', '{"x":2}')
    expect(readLocalStorage(localStorage)).toEqual({
      'a': '1',
      'model-provider': '{"x":2}',
    })
  })

  it('rejects files that are not Hi-chat data', () => {
    expect(() => parseDataFile('nope')).toThrow('not a Hi-chat data file')
    expect(() => parseDataFile('{"kind":"other"}')).toThrow()
    const ok = parseDataFile(
      JSON.stringify({
        kind: DATA_FILE_KIND,
        version: 1,
        localStorage: {},
        databases: [],
      })
    )
    expect(ok.kind).toBe(DATA_FILE_KIND)
  })

  it('imports settings into localStorage', async () => {
    localStorage.clear()
    const result = await importData(
      {
        kind: DATA_FILE_KIND,
        version: 1,
        exportedAt: '',
        localStorage: { key: 'value' },
        databases: [],
      },
      localStorage,
      {} as IDBFactory
    )
    expect(localStorage.getItem('key')).toBe('value')
    expect(result.chats).toBe(0)
  })

  it('names the file by date', () => {
    expect(dataFileName(new Date('2026-10-18T06:00:00Z'))).toBe(
      'hi-chat-data-2026-10-18.json'
    )
  })
})
