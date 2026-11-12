import { describe, expect, it } from 'vitest'
import {
  EXTENSION_SILENT_MS,
  KEEPALIVE_MS,
  SOUND_RATE,
  createSoundPacker,
  createSourcePicker,
  unpackSound,
} from '../callSound'

const tone = (n: number, amp = 0.5) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i / 5))

describe('the computer sound on its way to /mirror', () => {
  it('packs a 48 kHz block at half the rate, numbered, and unpacks it', () => {
    const pack = createSoundPacker(() => 0)
    const block = tone(1920)
    const first = unpackSound(pack(block, 48000))!
    expect(first.seq).toBe(1)
    expect(first.rate).toBe(SOUND_RATE)
    expect(first.samples).toHaveLength(960)
    // Each sample is the mean of two of the block's
    expect(first.samples[10]).toBeCloseTo((block[20] + block[21]) / 2, 3)
    expect(unpackSound(pack(block, 48000))!.seq).toBe(2)
  })

  it('keeps an unusual rate as it is rather than guess', () => {
    const p = unpackSound(createSoundPacker(() => 0)(tone(640), 16000))!
    expect(p.rate).toBe(16000)
    expect(p.samples).toHaveLength(640)
  })

  it('sends silence as a short "still here" once a second', () => {
    let now = 0
    const pack = createSoundPacker(() => now)
    const quiet = new Float32Array(1920)
    const first = pack(quiet, 48000)
    expect(first?.byteLength).toBe(8)
    expect(unpackSound(first)!.samples).toHaveLength(0)
    now += 40
    expect(pack(quiet, 48000)).toBeNull()
    now += KEEPALIVE_MS
    expect(pack(quiet, 48000)?.byteLength).toBe(8)
    // Sound goes at once
    now += 40
    expect(pack(tone(1920), 48000)!.byteLength).toBe(8 + 960 * 2)
  })

  it('takes nothing that is not a packet', () => {
    expect(unpackSound('hello')).toBeNull()
    expect(unpackSound(new ArrayBuffer(3))).toBeNull()
    expect(unpackSound(new ArrayBuffer(8))).toBeNull() // rate 0
  })
})

describe('which copy of the call is heard', () => {
  const quiet = {
    appAlive: true,
    appLoud: false,
    extensionLoud: false,
    talking: false,
  }

  it("is the extension's without the app's, as before", () => {
    const pick = createSourcePicker()
    expect(pick(50, { ...quiet, appAlive: false })).toBe('extension')
  })

  it("starts on the app's, and moves to the extension's once it brings sound", () => {
    const pick = createSourcePicker()
    expect(pick(50, quiet)).toBe('app')
    expect(pick(50, { ...quiet, appLoud: true })).toBe('app')
    expect(pick(50, { ...quiet, appLoud: true, extensionLoud: true })).toBe(
      'extension'
    )
    // Pauses in the call change nothing
    for (let i = 0; i < 100; i++) expect(pick(50, quiet)).toBe('extension')
  })

  it("goes back to the app's when the extension falls silent though the call is not", () => {
    const pick = createSourcePicker()
    pick(50, { ...quiet, appLoud: true, extensionLoud: true })
    let heard = 'extension'
    let ms = 0
    while (heard === 'extension' && ms < 10_000) {
      heard = pick(50, { ...quiet, appLoud: true })
      ms += 50
    }
    expect(heard).toBe('app')
    expect(ms).toBe(EXTENSION_SILENT_MS)
    // And returns when the extension's sound does
    expect(pick(50, { ...quiet, appLoud: true, extensionLoud: true })).toBe(
      'extension'
    )
  })

  it("doesn't take the viewer's own voice coming back for the call", () => {
    const pick = createSourcePicker()
    pick(50, { ...quiet, appLoud: true, extensionLoud: true })
    // Only the app's copy holds the viewer's voice: that is no sign the
    // extension stopped working
    for (let i = 0; i < 200; i++)
      expect(pick(50, { ...quiet, appLoud: true, talking: true })).toBe(
        'extension'
      )
  })
})
