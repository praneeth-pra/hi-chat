import { create } from 'zustand'
import { toast } from 'sonner'
import {
  TARGET_SAMPLE_RATE,
  concatSamples,
  downsample,
  rms,
} from '@/lib/speakerCapture'
import {
  RELAY_TOKEN_HEADER,
  fetchLiveToken,
  keyTerms,
  relayToken,
} from '@/lib/speakerCaptureSession'
import { GrokLiveTranscriber, LiveTranscriber } from '@/lib/speakerLive'
import { findMicDevice, getMicDevice } from '@/lib/micActivity'
import { useSpeakerTranscription } from '@/hooks/useSpeakerTranscription'

/**
 * Dictation: your own voice, recorded here and turned into text by Aqua's
 * dictation route (through the relay, which adds AQUA_API_KEY), so your Aqua
 * dictionary, replacements and instructions apply. Separate from the speaker,
 * which listens to the interviewer. The text is sent like a question.
 */

/**
 * Which service turns your voice into text. Only Aqua applies your Aqua
 * dictionary and replacements; ElevenLabs streams live while you talk.
 */
export type DictationEngine = 'aqua' | 'grok' | 'elevenlabs'
export const DICTATION_ENGINES: { value: DictationEngine; label: string }[] = [
  { value: 'aqua', label: 'Aqua' },
  { value: 'grok', label: 'Grok (live)' },
  { value: 'elevenlabs', label: 'ElevenLabs (live)' },
]
const ENGINE_STORAGE_KEY = 'dictation-engine'

export function getDictationEngine(): DictationEngine {
  try {
    const saved = localStorage.getItem(ENGINE_STORAGE_KEY)
    if (DICTATION_ENGINES.some((e) => e.value === saved))
      return saved as DictationEngine
  } catch {
    // Storage blocked
  }
  return 'aqua'
}

export function setDictationEngine(engine: DictationEngine) {
  try {
    localStorage.setItem(ENGINE_STORAGE_KEY, engine)
  } catch {
    // Storage blocked
  }
}

const KEEP_MIC_STORAGE_KEY = 'dictation-keep-mic'

/**
 * Keep the mic open between dictations so the next one starts instantly
 * (macOS shows the mic as in use while Jan is open). On by default.
 */
export function getKeepMicReady(): boolean {
  try {
    return localStorage.getItem(KEEP_MIC_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setKeepMicReady(on: boolean) {
  try {
    localStorage.setItem(KEEP_MIC_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Storage blocked
  }
  if (!on && !recording) closeMic()
}

/** Live engines: how long to wait for the last words after stopping. */
const LIVE_FINISH_MS = 8000

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

/**
 * While you talk, each stretch of speech that ends in a pause is sent to Aqua
 * right away, so when you stop only the last bit is left to transcribe.
 */
const PIECE_MIN_MS = 4000
const PAUSE_MS = 600
/** Below this loudness a block counts as a pause (used only to split). */
const SILENCE_RMS = 0.004

type LiveStream = Pick<LiveTranscriber, 'push' | 'finish' | 'abort'>

export type Recording = {
  rate: number
  engine: DictationEngine
  /** Live engines: the stream that gets every block as it comes */
  live?: LiveStream
  /** Audio not yet sent */
  chunks: Float32Array[]
  /** Silence at the end of chunks, in ms */
  quietMs: number
  /** The text of each piece sent so far, in order */
  pieces: Promise<string>[]
  limit: ReturnType<typeof setTimeout>
}

let recording: Recording | undefined

/** The open mic, kept between dictations when "keep the mic ready" is on. */
type Mic = {
  stream: MediaStream
  ctx: AudioContext
  tap: AudioWorkletNode
  /** The last moments before a dictation starts, so no first word is lost */
  preroll: Float32Array[]
}
let mic: Mic | undefined
const PREROLL_BLOCKS = 3 // ~130 ms at 48 kHz

function micAlive(m: Mic) {
  return (
    m.ctx.state === 'running' &&
    m.stream.getAudioTracks().some((t) => t.readyState === 'live')
  )
}

async function getMicStream(): Promise<MediaStream> {
  const media = navigator.mediaDevices
  const device = findMicDevice(await media.enumerateDevices(), getMicDevice())
  return media.getUserMedia({
    audio: {
      ...(device?.deviceId ? { deviceId: { exact: device.deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
    },
  })
}

/** A mic stream opened when Jan loads, before any click allows audio. */
let early: { stream: MediaStream; device: string } | undefined

function takeEarlyStream(): MediaStream | undefined {
  const e = early
  early = undefined
  if (!e) return undefined
  const live = e.stream.getAudioTracks().some((t) => t.readyState === 'live')
  if (live && e.device === getMicDevice()) return e.stream
  e.stream.getTracks().forEach((t) => t.stop())
  return undefined
}

// A new audio context each time the mic opens, made once the mic is open
// (Safari doesn't reliably restart a suspended one, so it's never suspended).
async function openMic(): Promise<Mic> {
  const stream = takeEarlyStream() ?? (await getMicStream())
  let ctx: AudioContext | undefined
  try {
    ctx = new AudioContext()
    const url = URL.createObjectURL(
      new Blob([TAP_WORKLET], { type: 'application/javascript' })
    )
    try {
      await ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    if (ctx.state !== 'running') await ctx.resume()
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop())
    ctx?.close().catch(() => {})
    throw err
  }
  const tap = new AudioWorkletNode(ctx, 'dictation-tap')
  ctx.createMediaStreamSource(stream).connect(tap)
  // Outputs silence; the connection just keeps the node running.
  tap.connect(ctx.destination)
  const m: Mic = { stream, ctx, tap, preroll: [] }
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (recording) return onBlock(recording, e.data)
    m.preroll.push(e.data)
    if (m.preroll.length > PREROLL_BLOCKS) m.preroll.shift()
  }
  return m
}

function closeMic() {
  takeEarlyStream()
    ?.getTracks()
    .forEach((t) => t.stop())
  if (!mic) return
  mic.tap.port.onmessage = null
  mic.tap.disconnect()
  mic.stream.getTracks().forEach((t) => t.stop())
  mic.ctx.close().catch(() => {})
  mic = undefined
}

function release() {
  if (recording) {
    clearTimeout(recording.limit)
    recording.live?.abort()
    recording = undefined
  }
  if (!getKeepMicReady()) closeMic()
}

let opening: Promise<Mic> | undefined

/** The open mic, opening it if needed (one open at a time). */
function ensureMic(): Promise<Mic> {
  if (mic && micAlive(mic)) return Promise.resolve(mic)
  if (!opening) {
    if (mic) closeMic()
    opening = openMic()
      .then((opened) => (mic = opened))
      .finally(() => (opening = undefined))
  }
  return opening
}

async function micAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    })
    return status.state === 'granted'
  } catch {
    return false
  }
}

let readied = false

/**
 * Gets the mic ready before the first dictation, when "keep the mic ready"
 * is on and the mic is already allowed for this site (never asks). Browsers
 * only start audio after a click or key press, so the mic itself opens when
 * Jan loads and the audio part follows the first click or key press anywhere.
 */
export function readyMicEarly() {
  if (readied || typeof window === 'undefined') return
  readied = true
  if (!navigator.mediaDevices?.getUserMedia) return
  if (typeof AudioWorkletNode === 'undefined') return
  const wanted = async () => getKeepMicReady() && (await micAllowed())
  void wanted().then(async (yes) => {
    if (!yes || early || mic || opening) return
    try {
      const stream = await getMicStream()
      if (early || mic || opening || !getKeepMicReady()) {
        stream.getTracks().forEach((t) => t.stop())
      } else early = { stream, device: getMicDevice() }
    } catch {
      // Opens on the first dictation instead
    }
  })
  const onGesture = () => {
    window.removeEventListener('pointerdown', onGesture, true)
    window.removeEventListener('keydown', onGesture, true)
    void wanted().then((yes) => {
      if (yes && !recording) ensureMic().catch(() => {})
    })
  }
  window.addEventListener('pointerdown', onGesture, true)
  window.addEventListener('keydown', onGesture, true)
}

/** Posts one piece of audio through the relay; resolves to its text. */
async function transcribe(
  chunks: Float32Array[],
  rate: number,
  engine: DictationEngine = 'aqua'
) {
  const samples = downsample(concatSamples(chunks), rate / TARGET_SAMPLE_RATE)
  // The mic had sent (almost) nothing; the engines reject an empty file
  if (samples.length < TARGET_SAMPLE_RATE / 20) return ''
  const wav = encodeWav(samples, TARGET_SAMPLE_RATE)
  const body = new FormData()
  if (engine === 'aqua') body.append('audio', wav, 'dictation.wav')
  else {
    body.append('file', wav, 'dictation.wav')
    body.append('engines', engine)
    body.append('need', '1')
  }
  const res = await fetch(
    engine === 'aqua' ? '/api/dictate' : '/api/transcribe',
    {
      method: 'POST',
      body,
      headers: { [RELAY_TOKEN_HEADER]: relayToken() },
    }
  )
  const data = (await res.json().catch(() => ({}))) as {
    text?: string
    error?: string
    results?: { ok: boolean; text?: string; error?: string }[]
  }
  const result = data.results?.[0]
  if (!res.ok)
    throw new Error(result?.error ?? data.error ?? `status ${res.status}`)
  return ((engine === 'aqua' ? data.text : result?.text) ?? '').trim()
}

/** Takes one block from the mic; exported for tests. */
export function onBlock(rec: Recording, block: Float32Array) {
  const level = rms(block)
  useDictation.setState({ level: Math.min(1, level * 8) })
  if (rec.live) {
    rec.live.push(downsample(block, rec.rate / TARGET_SAMPLE_RATE))
    return
  }
  rec.chunks.push(block)
  const blockMs = (block.length / rec.rate) * 1000
  rec.quietMs = level < SILENCE_RMS ? rec.quietMs + blockMs : 0
  const heldMs = (rec.chunks.length * block.length * 1000) / rec.rate
  if (rec.quietMs >= PAUSE_MS && heldMs >= PIECE_MIN_MS) {
    const piece = rec.chunks
    rec.chunks = []
    rec.quietMs = 0
    const text = transcribe(piece, rec.rate, rec.engine)
    text.catch(() => {}) // reported when the dictation is sent
    rec.pieces.push(text)
  }
}

function liveStream(engine: DictationEngine): LiveStream | undefined {
  if (engine === 'elevenlabs')
    return new LiveTranscriber(fetchLiveToken('elevenlabs'))
  if (engine === 'grok')
    return new GrokLiveTranscriber(
      fetchLiveToken('grok'),
      undefined,
      undefined,
      keyTerms()
    )
  return undefined
}

function begin(m: Mic) {
  const engine = getDictationEngine()
  const rec: Recording = {
    rate: m.ctx.sampleRate,
    engine,
    live: liveStream(engine),
    chunks: [],
    quietMs: 0,
    pieces: [],
    limit: setTimeout(() => void stopDictation(), MAX_DICTATION_MS),
  }
  recording = rec
  for (const block of m.preroll.splice(0)) onBlock(rec, block)
  useDictation.setState({ status: 'recording', startedAt: Date.now() })
}

export async function startDictation() {
  if (useDictation.getState().status !== 'idle') return
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof AudioWorkletNode === 'undefined'
  ) {
    toast('This browser cannot record the microphone')
    return
  }
  // The mic is already open: start right away
  if (mic && micAlive(mic)) return begin(mic)
  useDictation.setState({ status: 'starting', level: 0 })
  try {
    const m = await ensureMic()
    // Cancelled while the mic was opening
    if (useDictation.getState().status !== 'starting') {
      if (!getKeepMicReady()) closeMic()
      return
    }
    begin(m)
  } catch (err) {
    release()
    useDictation.setState({ status: 'idle', level: 0 })
    toast(`Microphone unavailable: ${(err as Error).message}`)
  }
}

/** Stops recording and sends the text Aqua returns, like a question. */
export async function stopDictation() {
  const { status, startedAt } = useDictation.getState()
  // Stopped before the mic opened: nothing was said yet
  if (status === 'starting') return cancelDictation()
  if (status !== 'recording' || !recording) return
  const { chunks, rate, pieces, engine, live } = recording
  // Keep the live stream open for its last words; release() would end it
  recording.live = undefined
  release()
  if (Date.now() - startedAt < MIN_DICTATION_MS) {
    live?.abort()
    useDictation.setState({ status: 'idle', level: 0 })
    return
  }
  useDictation.setState({ status: 'transcribing', level: 0 })
  try {
    const text = live
      ? (await live.finish(LIVE_FINISH_MS)).trim()
      : (await Promise.all([...pieces, transcribe(chunks, rate, engine)]))
          .filter(Boolean)
          .join(' ')
    if (text) useSpeakerTranscription.getState().enqueue(text)
    else
      toast(
        `${DICTATION_ENGINES.find((e) => e.value === engine)?.label} heard nothing`
      )
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
  else if (status === 'recording' || status === 'starting') void stopDictation()
}
