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

/** The level the leveler brings speech to, and how far it may lift it. */
const LEVEL_TARGET_RMS = 0.08
const LEVEL_MAX_GAIN = 8
/** Below this a block is a pause: the gain holds, so hiss isn't raised. */
const LEVEL_SPEECH_RMS = 0.004

/**
 * Makes a muffled or quiet far-side voice (computer audio) easier for the
 * engines: a high-pass at 90 Hz cuts rumble and boom, then a slow gain
 * brings speech to a steady level (up to 8x louder, never louder than full
 * scale). One per recording, so its state runs across the blocks.
 */
export class VoiceLeveler {
  private gain = 1
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0

  constructor(rate: number, cutoffHz = 90) {
    // RBJ cookbook high-pass, Q = 0.707
    const w = (2 * Math.PI * cutoffHz) / rate
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
    const cos = Math.cos(w)
    const a0 = 1 + alpha
    this.b0 = (1 + cos) / 2 / a0
    this.b1 = -(1 + cos) / a0
    this.b2 = (1 + cos) / 2 / a0
    this.a1 = (-2 * cos) / a0
    this.a2 = (1 - alpha) / a0
  }

  process(block: Float32Array): Float32Array {
    const out = new Float32Array(block.length)
    for (let i = 0; i < block.length; i++) {
      const x = block[i]
      const y =
        this.b0 * x +
        this.b1 * this.x1 +
        this.b2 * this.x2 -
        this.a1 * this.y1 -
        this.a2 * this.y2
      this.x2 = this.x1
      this.x1 = x
      this.y2 = this.y1
      this.y1 = y
      out[i] = y
    }
    const level = rms(out)
    const from = this.gain
    if (level >= LEVEL_SPEECH_RMS) {
      const wanted = Math.min(
        LEVEL_MAX_GAIN,
        Math.max(1, LEVEL_TARGET_RMS / level)
      )
      // Down fast (a loud word mustn't clip), up slowly (no pumping)
      this.gain += (wanted - this.gain) * (wanted < this.gain ? 0.5 : 0.08)
    }
    // Never past full scale, whatever the gain
    let peak = 0
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
    if (peak * this.gain > 0.98) this.gain = Math.max(1, 0.98 / peak)
    const step = (this.gain - from) / Math.max(1, out.length)
    for (let i = 0; i < out.length; i++)
      out[i] = Math.max(-1, Math.min(1, out[i] * (from + step * i)))
    return out
  }
}
