import { describe, it, expect } from 'vitest'
import { encodeFlacBytes } from '../flacEncoder'

describe('encodeFlacBytes', () => {
  const tone = (n: number) => {
    const s = new Float32Array(n)
    for (let i = 0; i < n; i++)
      s[i] = 0.4 * Math.sin(i / 6) * Math.sin(i / 3000)
    return s
  }

  it('writes a FLAC stream with the clip length in STREAMINFO', () => {
    const bytes = encodeFlacBytes(tone(16000 * 3 + 5), 16000)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('fLaC')
    expect(bytes[4]).toBe(0x80) // last metadata block, STREAMINFO
    const info = new DataView(bytes.buffer, 8, 34)
    // sample rate (20 bits) | channels-1 (3) | bps-1 (5) | total samples (36)
    expect(info.getUint32(10) >>> 12).toBe(16000)
    expect((info.getUint8(12) >> 1) & 0x7).toBe(0)
    expect(((info.getUint8(12) & 1) << 4) | (info.getUint8(13) >> 4)).toBe(15)
    expect(info.getUint32(14)).toBe(16000 * 3 + 5)
    // First frame starts with the sync code
    expect(bytes[42]).toBe(0xff)
    expect(bytes[43] & 0xfe).toBe(0xf8)
  })

  it('is much smaller than 16-bit WAV for tonal audio', () => {
    const n = 16000 * 5
    expect(encodeFlacBytes(tone(n), 16000).length).toBeLessThan(
      (44 + n * 2) / 2
    )
  })
})
