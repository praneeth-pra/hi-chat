import { describe, it, expect } from 'vitest'
import {
  PauseDetector,
  downsample,
  findSpeakerDevice,
  rms,
} from '../speakerCapture'

const device = (kind: string, label: string) =>
  ({ kind, label, deviceId: label }) as MediaDeviceInfo

describe('speakerCapture', () => {
  it('picks only the BlackHole input, never the built-in microphone', () => {
    expect(
      findSpeakerDevice([
        device('audioinput', 'MacBook Pro Microphone'),
        device('audiooutput', 'BlackHole 2ch'),
        device('audioinput', 'BlackHole 2ch (Virtual)'),
      ])?.label
    ).toBe('BlackHole 2ch (Virtual)')
    expect(
      findSpeakerDevice([device('audioinput', 'MacBook Pro Microphone')])
    ).toBeUndefined()
    expect(
      findSpeakerDevice([
        device('audioinput', 'BlackHole 16ch (Virtual)'),
        device('audioinput', 'BlackHole 2ch (Virtual)'),
      ])?.label
    ).toBe('BlackHole 2ch (Virtual)')
    expect(
      findSpeakerDevice([device('audioinput', 'BlackHole 16ch (Virtual)')])
        ?.label
    ).toBe('BlackHole 16ch (Virtual)')
  })

  it('starts after sustained sound and ends after a pause', () => {
    const d = new PauseDetector({ threshold: 0.1, startMs: 100, endMs: 500 })
    expect(d.feed(0.5, 0)).toBeNull()
    expect(d.feed(0, 50)).toBeNull() // blip too short
    expect(d.feed(0.5, 100)).toBeNull()
    expect(d.feed(0.5, 200)).toBe('start')
    expect(d.feed(0, 300)).toBeNull()
    expect(d.feed(0.5, 600)).toBeNull() // short gap inside speech
    expect(d.feed(0, 700)).toBeNull()
    expect(d.feed(0, 1199)).toBeNull()
    expect(d.feed(0, 1200)).toBe('end')
    expect(d.isSpeaking).toBe(false)
  })

  it('cuts very long utterances', () => {
    const d = new PauseDetector({ threshold: 0.1, startMs: 0, maxMs: 1000 })
    expect(d.feed(1, 0)).toBe('start')
    expect(d.feed(1, 999)).toBeNull()
    expect(d.feed(1, 1000)).toBe('end')
  })

  it('computes levels and downsamples', () => {
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5)
    expect(rms(new Float32Array())).toBe(0)
    expect(Array.from(downsample(new Float32Array([1, 3, 5, 7]), 2))).toEqual([
      2, 6,
    ])
  })
})
