import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  KEEPALIVE_MS,
  SOUND_RATE,
  createCallSoundPlayer,
  createSoundPacker,
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

describe("playing the app's sound on /mirror", () => {
  afterEach(() => vi.useRealTimers())

  // A stand-in for Web Audio: analysers report the level set on them
  const fakeAudio = (startState = 'running') => {
    const made = {
      state: startState,
      started: [] as number[],
      gain: [] as number[],
      levels: [] as { level: number }[],
      resumed: 0,
    }
    class Ctx {
      currentTime = 0
      destination = {}
      get state() {
        return made.state
      }
      createGain() {
        return {
          connect() {},
          gain: {
            value: 1,
            setTargetAtTime(v: number) {
              this.value = v
              made.gain.push(v)
            },
          },
        }
      }
      createAnalyser() {
        const a = {
          level: 0,
          fftSize: 8,
          getFloatTimeDomainData(buf: Float32Array) {
            buf.fill(a.level)
          },
        }
        made.levels.push(a)
        return a
      }
      createBuffer(_c: number, n: number, rate: number) {
        return { duration: n / rate, copyToChannel() {} }
      }
      createBufferSource() {
        return {
          buffer: null,
          connect() {},
          start(at: number) {
            made.started.push(at)
          },
        }
      }
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} }
      }
      resume() {
        made.resumed++
        return Promise.resolve()
      }
      close() {
        return Promise.resolve()
      }
    }
    return { made, Ctx: Ctx as unknown as typeof AudioContext }
  }
  const mic = {
    getAudioTracks: () => [{}],
  } as unknown as MediaStream

  it('plays packets one after another, and says when they arrive and stop', () => {
    vi.useFakeTimers()
    vi.stubGlobal('MediaStream', class {})
    const { made, Ctx } = fakeAudio()
    const states: { arriving: boolean; loud: boolean }[] = []
    const player = createCallSoundPlayer({
      onState: (s) => states.push(s),
      onBlocked: () => {},
      AudioContextImpl: Ctx,
    })
    const pack = createSoundPacker(() => 0)
    player.push(pack(tone(1920), 48000))
    player.push(pack(tone(1920), 48000))
    expect(made.started).toHaveLength(2)
    expect(made.started[1] - made.started[0]).toBeCloseTo(0.04, 5)
    made.levels[0].level = 0.1 // the app's sound
    vi.advanceTimersByTime(60)
    expect(states.at(-1)).toEqual({ arriving: true, loud: true })
    // The same packet again, or an older one, is not played twice
    const again = pack(tone(1920), 48000)
    player.push(again)
    player.push(again)
    expect(made.started).toHaveLength(3)
    // Nothing more comes: the sound is gone
    made.levels[0].level = 0
    vi.advanceTimersByTime(7000)
    expect(states.at(-1)).toEqual({ arriving: false, loud: false })
    player.close()
    vi.unstubAllGlobals()
  })

  it('turns the sound down while the viewer talks, and off when muted', () => {
    vi.useFakeTimers()
    vi.stubGlobal('MediaStream', class {})
    const { made, Ctx } = fakeAudio()
    const player = createCallSoundPlayer({
      onState: () => {},
      onBlocked: () => {},
      AudioContextImpl: Ctx,
    })
    player.setMic(mic)
    vi.advanceTimersByTime(60)
    expect(made.gain.at(-1)).toBe(1)
    made.levels[1].level = 0.2 // the viewer's mic
    vi.advanceTimersByTime(60)
    expect(made.gain.at(-1)).toBeLessThan(0.1)
    made.levels[1].level = 0
    vi.advanceTimersByTime(500)
    expect(made.gain.at(-1)).toBeLessThan(0.1)
    vi.advanceTimersByTime(600)
    expect(made.gain.at(-1)).toBe(1)
    player.setMuted(true)
    expect(made.gain.at(-1)).toBe(0)
    player.setMuted(false)
    expect(made.gain.at(-1)).toBe(1)
    player.close()
    vi.unstubAllGlobals()
  })

  it('asks for a click when the browser holds the sound back', () => {
    vi.useFakeTimers()
    const { made, Ctx } = fakeAudio('suspended')
    let blocked = 0
    const player = createCallSoundPlayer({
      onState: () => {},
      onBlocked: () => blocked++,
      AudioContextImpl: Ctx,
    })
    vi.advanceTimersByTime(200)
    expect(blocked).toBe(0) // no sound to hold back yet
    player.push(createSoundPacker(() => 0)(tone(1920), 48000))
    vi.advanceTimersByTime(200)
    expect(blocked).toBe(1)
    expect(made.started).toHaveLength(0)
    made.state = 'running'
    player.resume()
    player.push(createSoundPacker(() => 5)(tone(1920), 48000))
    vi.advanceTimersByTime(200)
    expect(blocked).toBe(1)
    player.close()
  })
})
