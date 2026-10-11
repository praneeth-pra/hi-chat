/** Sample rate the audio is reduced to before upload (plenty for speech). */
export const TARGET_SAMPLE_RATE = 16000

/** Root-mean-square level of a block of samples. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/** Reduces sample rate by averaging; `ratio` is input rate / output rate. */
export function downsample(samples: Float32Array, ratio: number): Float32Array {
  if (ratio <= 1) return samples
  const out = new Float32Array(Math.floor(samples.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * ratio)
    const to = Math.min(samples.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = from; j < to; j++) sum += samples[j]
    out[i] = sum / Math.max(1, to - from)
  }
  return out
}

export function concatSamples(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}
