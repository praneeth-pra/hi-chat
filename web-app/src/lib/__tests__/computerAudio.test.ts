import { describe, it, expect, vi } from 'vitest'
import {
  decodePcm,
  openComputerAudio,
  getDictationSource,
  setDictationSource,
} from '../computerAudio'
import { VoiceLeveler, rms } from '../speechAudio'

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

describe('shared computer audio', () => {
  it('runs one capture for every listener, stopped with the last', async () => {
    const posted: unknown[] = []
    const win = window as unknown as {
      webkit?: unknown
      hiChatComputerAudio?: (m: unknown) => void
    }
    win.webkit = {
      messageHandlers: {
        hiChat: { postMessage: (m: unknown) => posted.push(m) },
      },
    }
    const pcm = btoa(String.fromCharCode(0x00, 0x40))
    const a = vi.fn()
    const b = vi.fn()
    const first = openComputerAudio(a)
    const second = openComputerAudio(b)
    expect(posted).toEqual([{ computerAudio: 'start' }])
    win.hiChatComputerAudio?.({ computerAudio: 'started', rate: 48000 })
    const [one, two] = await Promise.all([first, second])
    expect(one.rate).toBe(48000)
    win.hiChatComputerAudio?.({ computerAudio: 'data', pcm })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    // Dictation stops: the other listener keeps getting the sound
    one.close()
    expect(posted).toHaveLength(1)
    expect(one.alive()).toBe(false)
    expect(two.alive()).toBe(true)
    win.hiChatComputerAudio?.({ computerAudio: 'data', pcm })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)

    two.close()
    expect(posted.at(-1)).toEqual({ computerAudio: 'stop' })
    expect(win.hiChatComputerAudio).toBeUndefined()

    // And starts again for a new listener
    const third = openComputerAudio(a)
    expect(posted.at(-1)).toEqual({ computerAudio: 'start' })
    win.hiChatComputerAudio?.({
      computerAudio: 'failed',
      error: 'No permission',
    })
    await expect(third).rejects.toThrow('No permission')
    delete win.webkit
  })
})

describe('voice leveler', () => {
  const tone = (amp: number, hz: number, n = 1920, rate = 48000) =>
    Float32Array.from(
      { length: n },
      (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate)
    )

  it('lifts a quiet voice towards a steady level, never past full scale', () => {
    const lev = new VoiceLeveler(48000)
    let out = new Float32Array()
    for (let i = 0; i < 60; i++) out = lev.process(tone(0.01, 400))
    expect(rms(out)).toBeGreaterThan(0.05)
    expect(rms(out)).toBeLessThan(0.1)
    const loud = lev.process(tone(0.9, 400))
    expect(Math.max(...loud.map(Math.abs))).toBeLessThanOrEqual(1)
  })

  it('leaves pauses alone and cuts low rumble', () => {
    const lev = new VoiceLeveler(48000)
    const hiss = lev.process(tone(0.001, 400))
    expect(rms(hiss)).toBeLessThan(0.002)
    // Loud enough that the gain stays at 1: only the 20 Hz half is cut
    const rumble = new VoiceLeveler(48000)
    const mix = (n = 1920) =>
      tone(0.3, 400, n).map(
        (v, i) => v + 0.3 * Math.sin((2 * Math.PI * 20 * i) / 48000)
      )
    let out = new Float32Array()
    for (let i = 0; i < 10; i++) out = rumble.process(mix())
    expect(rms(out)).toBeGreaterThan(0.19) // the 400 Hz tone alone: 0.212
    expect(rms(out)).toBeLessThan(0.23) // with the rumble: 0.3
  })
})
