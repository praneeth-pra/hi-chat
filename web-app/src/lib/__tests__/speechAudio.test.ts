import { describe, it, expect } from 'vitest'
import { rms, downsample, concatSamples } from '../speechAudio'
describe('dictation audio helpers', () => {
  it('preserves audio when downsampling and concatenating captured blocks', () => {
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5)
    expect(rms(new Float32Array())).toBe(0)
    expect(Array.from(downsample(new Float32Array([1, 3, 5, 7]), 2))).toEqual([
      2, 6,
    ])
    expect(
      Array.from(
        concatSamples([new Float32Array([1, 2]), new Float32Array([3])])
      )
    ).toEqual([1, 2, 3])
  })
})
