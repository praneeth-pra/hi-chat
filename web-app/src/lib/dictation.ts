import { create } from 'zustand'
import { toast } from 'sonner'
import {
  TARGET_SAMPLE_RATE,
  concatSamples,
  downsample,
  rms,
} from '@/lib/speakerCapture'
import { RELAY_TOKEN_HEADER, relayToken } from '@/lib/speakerCaptureSession'
import { findMicDevice, getMicDevice } from '@/lib/micActivity'
import { useSpeakerTranscription } from '@/hooks/useSpeakerTranscription'

/**
 * Dictation: your own voice, recorded here and turned into text by Aqua's
 * dictation route (through the relay, which adds AQUA_API_KEY), so your Aqua
 * dictionary, replacements and instructions apply. Separate from the speaker,
 * which listens to the interviewer. The text is sent like a question.
 */

export type DictationStatus = 'idle' | 'starting' | 'recording' | 'transcribing'

type DictationState = {
  status: DictationStatus
  /** Loudness of the last ~40 ms (0-1), for the recording animation. */
  level: number
  /** When recording started (ms). */
  startedAt: number
}

export const useDictation = create<DictationState>(() => ({
  status: 'idle',
  level: 0,
  startedAt: 0,
}))

/** Aqua takes up to 10 minutes; stop a little before. */
export const MAX_DICTATION_MS = 9.5 * 60 * 1000
/** Shorter than this is a slip of the key: nothing is sent. */
const MIN_DICTATION_MS = 400

/** 16-bit PCM mono WAV, the format Aqua's dictation route asks for. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([wavBytes(samples, sampleRate)], { type: 'audio/wav' })
}

export function wavBytes(
  samples: Float32Array,
  sampleRate: number
): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      view.setUint8(at + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}

// Copies the mic to the main thread in ~40 ms blocks (the audio thread keeps
// running while the tab is in the background).
const TAP_WORKLET = `
class DictationTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i]
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf)
          this.buf = new Float32Array(2048)
          this.n = 0
        }
      }
    }
    return true
  }
}
registerProcessor('dictation-tap', DictationTap)
`

let recording:
  | {
      stream: MediaStream
      ctx: AudioContext
      chunks: Float32Array[]
      limit: ReturnType<typeof setTimeout>
    }
  | undefined

function release() {
  if (!recording) return
  clearTimeout(recording.limit)
  recording.stream.getTracks().forEach((t) => t.stop())
  recording.ctx.close().catch(() => {})
  recording = undefined
}

export async function startDictation() {
  if (useDictation.getState().status !== 'idle') return
  const media = navigator.mediaDevices
  if (!media?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
    toast('This browser cannot record the microphone')
    return
  }
  useDictation.setState({ status: 'starting', level: 0 })
  try {
    const device = findMicDevice(await media.enumerateDevices(), getMicDevice())
    const stream = await media.getUserMedia({
      audio: {
        ...(device?.deviceId ? { deviceId: { exact: device.deviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
      },
    })
    const ctx = new AudioContext()
    const url = URL.createObjectURL(
      new Blob([TAP_WORKLET], { type: 'application/javascript' })
    )
    try {
      await ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    const tap = new AudioWorkletNode(ctx, 'dictation-tap')
    ctx.createMediaStreamSource(stream).connect(tap)
    // Outputs silence; the connection just keeps the node running.
    tap.connect(ctx.destination)
    const chunks: Float32Array[] = []
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      chunks.push(e.data)
      useDictation.setState({ level: Math.min(1, rms(e.data) * 8) })
    }
    // Cancelled while the mic was opening
    if (useDictation.getState().status !== 'starting') {
      stream.getTracks().forEach((t) => t.stop())
      ctx.close().catch(() => {})
      return
    }
    recording = {
      stream,
      ctx,
      chunks,
      limit: setTimeout(() => void stopDictation(), MAX_DICTATION_MS),
    }
    useDictation.setState({ status: 'recording', startedAt: Date.now() })
  } catch (err) {
    release()
    useDictation.setState({ status: 'idle', level: 0 })
    toast(`Microphone unavailable: ${(err as Error).message}`)
  }
}

/** Stops recording and sends the text Aqua returns, like a question. */
export async function stopDictation() {
  const { status, startedAt } = useDictation.getState()
  // Let go before the mic opened: nothing was said yet
  if (status === 'starting') return cancelDictation()
  if (status !== 'recording' || !recording) return
  const { ctx, chunks } = recording
  const rate = ctx.sampleRate
  release()
  if (Date.now() - startedAt < MIN_DICTATION_MS) {
    useDictation.setState({ status: 'idle', level: 0 })
    return
  }
  useDictation.setState({ status: 'transcribing', level: 0 })
  try {
    const samples = downsample(concatSamples(chunks), rate / TARGET_SAMPLE_RATE)
    // The mic had sent (almost) nothing yet; Aqua rejects an empty file
    if (samples.length < TARGET_SAMPLE_RATE / 20) return
    const body = new FormData()
    body.append(
      'audio',
      encodeWav(samples, TARGET_SAMPLE_RATE),
      'dictation.wav'
    )
    const res = await fetch('/api/dictate', {
      method: 'POST',
      body,
      headers: { [RELAY_TOKEN_HEADER]: relayToken() },
    })
    const data = (await res.json().catch(() => ({}))) as {
      text?: string
      error?: string
    }
    if (!res.ok) throw new Error(data.error ?? `status ${res.status}`)
    const text = (data.text ?? '').trim()
    if (text) useSpeakerTranscription.getState().enqueue(text)
    else toast('Aqua heard nothing')
  } catch (err) {
    toast(`Dictation failed: ${(err as Error).message}`)
  } finally {
    useDictation.setState({ status: 'idle', level: 0 })
  }
}

/** Throws the recording away without sending it. */
export function cancelDictation() {
  const { status } = useDictation.getState()
  if (status !== 'recording' && status !== 'starting') return
  release()
  useDictation.setState({ status: 'idle', level: 0 })
}

export function toggleDictation() {
  const { status } = useDictation.getState()
  if (status === 'idle') void startDictation()
  else if (status === 'recording') void stopDictation()
}
