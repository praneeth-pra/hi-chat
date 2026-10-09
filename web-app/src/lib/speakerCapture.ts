/**
 * Speaker-to-prompt helpers: find the loopback device that carries the Mac's
 * own sound (BlackHole) and split its audio into utterances at pauses for
 * transcription.
 */

/** Sample rate the audio is reduced to before upload (plenty for speech). */
export const TARGET_SAMPLE_RATE = 16000

/** Only loopback devices are used; the real microphone is never opened for recording. */
export const SPEAKER_DEVICE_PATTERN = /blackhole/i

/** Prefers BlackHole 2ch (the one set up in the Multi-Output Device). */
export function findSpeakerDevice<
  T extends Pick<MediaDeviceInfo, 'kind' | 'label' | 'deviceId'>,
>(devices: T[]): T | undefined {
  const loopbacks = devices.filter(
    (d) => d.kind === 'audioinput' && SPEAKER_DEVICE_PATTERN.test(d.label)
  )
  return loopbacks.find((d) => /\b2ch\b/i.test(d.label)) ?? loopbacks[0]
}

export type PauseDetectorOptions = {
  /** RMS level (0..1) above which audio counts as sound. */
  threshold: number
  /** Sound must last this long before an utterance starts. */
  startMs: number
  /** Silence this long ends an utterance. */
  endMs: number
  /** Utterances are cut at this length even without a pause. */
  maxMs: number
}

export const DEFAULT_PAUSE_OPTIONS: PauseDetectorOptions = {
  threshold: 0.01,
  startMs: 150,
  endMs: 900,
  maxMs: 60000,
}

/**
 * With "wait for the rest of a question" on, a clip can end sooner: a
 * question cut by a pause is joined back together, so answers start ~0.3 s
 * earlier.
 */
export const WAIT_MODE_END_MS = 600

export type PauseEvent = 'start' | 'end' | null

/**
 * Turns a stream of (level, time) samples into utterance start/end events.
 * Pure state machine so it can be tested without audio.
 */
export class PauseDetector {
  private opts: PauseDetectorOptions
  private speaking = false
  private loudSince: number | null = null
  private quietSince: number | null = null
  private startedAt = 0

  constructor(opts: Partial<PauseDetectorOptions> = {}) {
    this.opts = { ...DEFAULT_PAUSE_OPTIONS, ...opts }
  }

  get isSpeaking() {
    return this.speaking
  }

  feed(level: number, now: number): PauseEvent {
    const loud = level >= this.opts.threshold
    if (!this.speaking) {
      if (!loud) {
        this.loudSince = null
        return null
      }
      this.loudSince ??= now
      if (now - this.loudSince >= this.opts.startMs) {
        this.speaking = true
        this.startedAt = this.loudSince
        this.quietSince = null
        return 'start'
      }
      return null
    }

    if (now - this.startedAt >= this.opts.maxMs) {
      this.reset()
      return 'end'
    }
    if (loud) {
      this.quietSince = null
      return null
    }
    this.quietSince ??= now
    if (now - this.quietSince >= this.opts.endMs) {
      this.reset()
      return 'end'
    }
    return null
  }

  reset() {
    this.speaking = false
    this.loudSince = null
    this.quietSince = null
  }
}

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
