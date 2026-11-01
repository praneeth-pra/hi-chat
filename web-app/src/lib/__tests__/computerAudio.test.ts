import { describe, it, expect } from 'vitest'
import {
  decodePcm,
  getDictationSource,
  setDictationSource,
} from '../computerAudio'

describe('computer audio', () => {
  it('records the computer audio by default, the mic when chosen', () => {
    localStorage.removeItem('dictation-source')
    expect(getDictationSource()).toBe('computer')
    setDictationSource('mic')
    expect(getDictationSource()).toBe('mic')
    localStorage.removeItem('dictation-source')
  })

  it("decodes the app's 16-bit samples", () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0x00, 0x40,
    ])
    const samples = decodePcm(btoa(String.fromCharCode(...bytes)))
    expect(Array.from(samples)).toEqual([0, 32767 / 32768, -1, 0.5])
  })
})
