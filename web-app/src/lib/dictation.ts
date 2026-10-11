import { create } from 'zustand'
import { toast } from 'sonner'
import {
  TARGET_SAMPLE_RATE,
  concatSamples,
  downsample,
  rms,
} from '@/lib/speechAudio'
import {
  fetchLiveToken,
  fetchLiveKeyWithTerms,
  keyTerms,
  reportSpeech,
} from '@/lib/speechServices'
import {
  elevenLabsTerms,
  CartesiaLiveTranscriber,
  GrokLiveTranscriber,
  LiveTranscriber,
  SonioxLiveTranscriber,
} from '@/lib/speechLive'
import { applyFixes } from '@/lib/dictationFixes'
import { findMicDevice, getDictationMic } from '@/lib/micActivity'
import { deliverDictation } from './dictationDelivery'
import {
  SKIP_AGREEMENT,
  judgeDictation,
  textAgreement,
} from '@/lib/dictationJudge'

/**
 * Dictation: speech heard by your selected microphone, streamed to live
 * speech-to-text engines while you record. Playback suppression is off by default.
 * Stopping dictation delivers the text to the chat.
 */

/**
 * Which service turns your voice into text. Soniox gets your dictionary as
 * context terms and Cartesia the 100 that fit; all four stream live while
 * you talk. Auto runs Cartesia, Soniox and ElevenLabs: as soon as two agree
 * their text is sent, else a judge model writes the best version. Grok was
 * left out of Auto: on P's questions it was the slowest and least accurate.
 */
export type DictationEngine =
  | 'grok'
  | 'elevenlabs'
  | 'soniox'
  | 'cartesia'
  | 'auto'
export const DICTATION_ENGINES: { value: DictationEngine; label: string }[] = [
  { value: 'auto', label: 'Auto (Cartesia + Soniox + ElevenLabs)' },
  { value: 'soniox', label: 'Soniox (live)' },
  { value: 'cartesia', label: 'Cartesia (live)' },
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
  return 'auto'
}

export function setDictationEngine(engine: DictationEngine) {
  try {
    localStorage.setItem(ENGINE_STORAGE_KEY, engine)
  } catch {
    // Storage blocked
  }
}

const REDUCE_ECHO_STORAGE_KEY = 'dictation-reduce-echo'

/** Off by default: retain speech played near the microphone, not only your voice. */
export function getDictationReduceEcho(): boolean {
  try {
    return localStorage.getItem(REDUCE_ECHO_STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}
export function setDictationReduceEcho(on: boolean) {
  try {
    localStorage.setItem(REDUCE_ECHO_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    /* Storage blocked */
  }
  switchMic()
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
/**
 * Auto: once one engine has answered, how long the others get. On P's
 * questions all three live engines answered within 0.6 s of stopping.
 */
const AUTO_GRACE_MS = 1000

export type DictationStatus = 'idle' | 'starting' | 'recording' | 'transcribing'

type DictationState = {
  status: DictationStatus
  /** Loudness of the last ~40 ms (0-1), for the recording animation. */
  level: number
  /** When recording started (ms). */
  startedAt: number
  /** Why the last dictation failed; its audio is kept for retryDictation(). */
  failed?: string
}

export const useDictation = create<DictationState>(() => ({
  status: 'idle',
  level: 0,
  startedAt: 0,
}))

/** The audio of the dictation that failed, until it is retried or dismissed. */
let failedAudio: Float32Array | undefined

/** A dictation stops by itself after this long. */
export const MAX_DICTATION_MS = 9.5 * 60 * 1000
/** Shorter than this is a slip of the key: nothing is sent. */
const MIN_DICTATION_MS = 400

/** 16-bit PCM mono WAV. */
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

type LiveStream = Pick<LiveTranscriber, 'push' | 'finish' | 'abort'>

export type Recording = {
  rate: number
  engine: DictationEngine
  /** Live engines: the stream that gets every block as it comes */
  live?: LiveStream
  /** Auto: the live engines that each get every block */
  autoLive?: { engine: DictationEngine; stream: LiveStream }[]
  /**
   * Every block at 16 kHz, for the batch route when the live engines fail
   * or hear nothing (~64 KB a second)
   */
  audio: Float32Array[]
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
  /** The Microphone setting it was opened for */
  device: string
  /** Which input that was (its group), to notice when the default changes */
  deviceKey?: string
  reduceEcho: boolean
}
let mic: Mic | undefined
const PREROLL_BLOCKS = 3 // ~130 ms at 48 kHz

function micAlive(m: Mic) {
  return (
    m.ctx.state === 'running' &&
    m.stream.getAudioTracks().some((t) => t.readyState === 'live')
  )
}

/** The input the Microphone setting picks right now, and its key. */
async function wantedMic() {
  const devices = await navigator.mediaDevices.enumerateDevices()
  const device = findMicDevice(devices, getDictationMic())
  return { device, key: device ? device.groupId || device.deviceId : undefined }
}

type MicStream = {
  stream: MediaStream
  device: string
  key?: string
  reduceEcho: boolean
}

async function getMicStream(): Promise<MicStream> {
  const label = getDictationMic()
  const { device, key } = await wantedMic()
  const reduceEcho = getDictationReduceEcho()
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(device?.deviceId ? { deviceId: { exact: device.deviceId } } : {}),
      echoCancellation: reduceEcho,
      noiseSuppression: reduceEcho,
    },
  })
  return { stream, device: label, key, reduceEcho }
}

/** A mic stream opened when Jan loads, before any click allows audio. */
let early: MicStream | undefined

function takeEarlyStream(): MicStream | undefined {
  const e = early
  early = undefined
  if (!e) return undefined
  const live = e.stream.getAudioTracks().some((t) => t.readyState === 'live')
  if (
    live &&
    e.device === getDictationMic() &&
    e.reduceEcho === getDictationReduceEcho()
  )
    return e
  e.stream.getTracks().forEach((t) => t.stop())
  return undefined
}

// A new audio context each time the mic opens, made once the mic is open
// (Safari doesn't reliably restart a suspended one, so it's never suspended).
async function openMic(): Promise<Mic> {
  const { stream, device, key, reduceEcho } =
    takeEarlyStream() ?? (await getMicStream())
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
  const m: Mic = {
    stream,
    ctx,
    tap,
    preroll: [],
    device,
    deviceKey: key,
    reduceEcho,
  }
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (recording) return onBlock(recording, e.data)
    m.preroll.push(e.data)
    if (m.preroll.length > PREROLL_BLOCKS) m.preroll.shift()
  }
  return m
}

function closeMic() {
  takeEarlyStream()
    ?.stream.getTracks()
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
    recording.autoLive?.forEach((l) => l.stream.abort())
    recording = undefined
  }
  if (!getKeepMicReady()) closeMic()
}

let opening: Promise<Mic> | undefined

/** The mic is open, and on the input the Microphone setting picks. */
function micReady(m: Mic) {
  return (
    micAlive(m) &&
    m.device === getDictationMic() &&
    m.reduceEcho === getDictationReduceEcho()
  )
}

/** The open mic, opening it if needed (one open at a time). */
function ensureMic(): Promise<Mic> {
  if (mic && micReady(mic)) return Promise.resolve(mic)
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
      const opened = await getMicStream()
      if (early || mic || opening || !getKeepMicReady()) {
        opened.stream.getTracks().forEach((t) => t.stop())
      } else early = opened
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
  // A mic plugged in or out (AirPods connecting) can change which input the
  // setting picks; the open mic follows it
  navigator.mediaDevices.addEventListener?.('devicechange', () => {
    if (recording || opening || !mic) return
    const open = mic
    void wantedMic()
      .then(({ key }) => {
        if (mic === open && key !== open.deviceKey) switchMic()
      })
      .catch(() => {})
  })
}

/**
 * Moves an open mic to the input the Microphone setting picks now (after
 * the setting changes). A dictation in progress keeps its mic; the next one
 * opens the new input.
 */
export function switchMic() {
  if (recording || opening || (!mic && !early)) return
  closeMic()
  if (getKeepMicReady()) ensureMic().catch(() => {})
}

/**
 * The relay's batch route (ElevenLabs and Grok, the first answer wins), for
 * a dictation the live engines lost. Resolves to its text.
 */
async function transcribe(samples: Float32Array): Promise<string> {
  // The mic had sent (almost) nothing; the engines reject an empty file
  if (samples.length < TARGET_SAMPLE_RATE / 20) return ''
  const body = new FormData()
  body.append('file', encodeWav(samples, TARGET_SAMPLE_RATE), 'dictation.wav')
  body.append('need', '1')
  body.append('require_text', '1')
  const res = await fetch('/api/transcribe', { method: 'POST', body })
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    results?: { ok: boolean; text?: string; error?: string }[]
  }
  if (!res.ok) {
    const errors = data.results?.map((r) => r.error).filter(Boolean)
    throw new Error(errors?.join('; ') || data.error || `status ${res.status}`)
  }
  return (data.results?.find((r) => r.ok && r.text?.trim())?.text ?? '').trim()
}

/** Takes one block from the mic; exported for tests. */
export function onBlock(rec: Recording, block: Float32Array) {
  const level = rms(block)
  useDictation.setState({ level: Math.min(1, level * 8) })
  const down = downsample(block, rec.rate / TARGET_SAMPLE_RATE)
  rec.audio.push(down)
  rec.live?.push(down)
  rec.autoLive?.forEach((l) => l.stream.push(down))
}

function liveStream(engine: DictationEngine): LiveStream | undefined {
  if (engine === 'elevenlabs')
    return new LiveTranscriber(
      fetchLiveToken('elevenlabs'),
      undefined,
      elevenLabsTerms(keyTerms())
    )
  if (engine === 'grok')
    return new GrokLiveTranscriber(
      fetchLiveToken('grok'),
      undefined,
      undefined,
      keyTerms()
    )
  if (engine === 'soniox')
    return new SonioxLiveTranscriber(
      fetchLiveKeyWithTerms('soniox'),
      undefined,
      keyTerms()
    )
  if (engine === 'cartesia')
    return new CartesiaLiveTranscriber(
      fetchLiveKeyWithTerms('cartesia'),
      undefined,
      keyTerms()
    )
  return undefined
}

function autoLiveStreams() {
  // Cartesia first: when it agrees with another engine its text is sent
  // (it had the most words right on P's questions), then Soniox
  return (['cartesia', 'soniox', 'elevenlabs'] as const).map((engine) => ({
    engine,
    stream: liveStream(engine)!,
  }))
}

export type EngineText = { engine: DictationEngine; text: string }
export { textAgreement }

/**
 * The text without "uh"/"um" (Cartesia and Soniox write them out) or a
 * leading "..." (ElevenLabs, when you start mid-sentence).
 */
export function withoutFillers(text: string): string {
  const clean = text
    .replace(/,?\s*\b(?:u+h+|u+m+|uhm|e+rm|h+m+)\b[,.]?(?=\s|$)/gi, '')
    .replace(/^[\s.…,-]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  // Capitalise the start of each sentence a filler opened
  return clean.replace(
    /(^|[.?!]\s+)(\p{Ll})/gu,
    (_, end, c) => end + c.toUpperCase()
  )
}

/**
 * Auto: the text the other engines agree with most, since a word one engine
 * mishears the others usually get right. With a tie (or only two answers)
 * the earlier one wins: Cartesia, then Soniox.
 */
export function pickBest(results: EngineText[]): EngineText | undefined {
  const heard = results.filter((r) => r.text)
  if (heard.length < 3) return heard[0]
  let best = heard[0]
  let bestScore = -1
  for (const r of heard) {
    const score = heard
      .filter((o) => o !== r)
      .reduce((sum, o) => sum + textAgreement(r.text, o.text), 0)
    if (score > bestScore + 1e-9) {
      best = r
      bestScore = score
    }
  }
  return best
}

/**
 * Waits for every engine, but only AUTO_GRACE_MS once the first has text,
 * and not at all once two engines agree (the judge would skip anyway).
 */
export function gatherAuto(
  jobs: { engine: DictationEngine; text: Promise<string> }[]
): Promise<EngineText[]> {
  return new Promise((resolve, reject) => {
    const done: EngineText[] = []
    const errors: string[] = []
    let left = jobs.length
    let grace: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      clearTimeout(grace)
      if (!done.length && errors.length) reject(new Error(errors.join('; ')))
      // Keep the engines' order, so ties go to the first (Cartesia)
      else
        resolve(jobs.flatMap((j) => done.filter((d) => d.engine === j.engine)))
    }
    jobs.forEach(({ engine, text }) =>
      text
        .then((t) => {
          const text = t.trim()
          const agreed =
            text &&
            done.some(
              (d) => d.text && textAgreement(d.text, text) >= SKIP_AGREEMENT
            )
          done.push({ engine, text })
          if (agreed) finish()
          else if (text && !grace) grace = setTimeout(finish, AUTO_GRACE_MS)
        })
        .catch((err) => errors.push(`${engine}: ${(err as Error).message}`))
        .finally(() => {
          if (--left === 0) finish()
        })
    )
  })
}

function begin(m: Mic) {
  const engine = getDictationEngine()
  const rec: Recording = {
    rate: m.ctx.sampleRate,
    engine,
    live: liveStream(engine),
    autoLive: engine === 'auto' ? autoLiveStreams() : undefined,
    audio: [],
    limit: setTimeout(() => void stopDictation(), MAX_DICTATION_MS),
  }
  recording = rec
  for (const block of m.preroll.splice(0)) onBlock(rec, block)
  useDictation.setState({ status: 'recording', startedAt: Date.now() })
}

/**
 * Each start gets a number; cancelling, or a newer start, makes an older one
 * still waiting for the mic give up without touching the mic.
 */
let generation = 0

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
  if (mic && micReady(mic)) return begin(mic)
  const gen = ++generation
  useDictation.setState({ status: 'starting', level: 0 })
  try {
    const m = await ensureMic()
    // Cancelled while the mic was opening (and maybe started again, in
    // which case the newer start owns the mic)
    if (gen !== generation || useDictation.getState().status !== 'starting') {
      if (useDictation.getState().status === 'idle' && !getKeepMicReady())
        closeMic()
      return
    }
    begin(m)
  } catch (err) {
    if (gen !== generation) return
    release()
    useDictation.setState({ status: 'idle', level: 0 })
    toast(`Microphone unavailable: ${(err as Error).message}`)
  }
}

/** Stops recording and sends the engines' text, like a question. */
export async function stopDictation() {
  const { status, startedAt } = useDictation.getState()
  // Stopped before the mic opened: nothing was said yet
  if (status === 'starting') return cancelDictation()
  if (status !== 'recording' || !recording) return
  const { engine, live, autoLive, audio } = recording
  // Keep the live streams open for their last words; release() would end them
  recording.live = undefined
  recording.autoLive = undefined
  release()
  if (Date.now() - startedAt < MIN_DICTATION_MS) {
    live?.abort()
    autoLive?.forEach((l) => l.stream.abort())
    useDictation.setState({ status: 'idle', level: 0 })
    return
  }
  useDictation.setState({ status: 'transcribing', level: 0 })
  const stoppedAt = Date.now()
  const label = DICTATION_ENGINES.find((e) => e.value === engine)?.label
  let text = ''
  let liveError: Error | undefined
  try {
    if (live) text = (await live.finish(LIVE_FINISH_MS)).trim()
    else if (autoLive) {
      const took: Partial<Record<DictationEngine, number>> = {}
      const timed = (engine: DictationEngine, text: Promise<string>) => ({
        engine,
        text: text.then((t) => {
          took[engine] = Date.now() - stoppedAt
          return t
        }),
      })
      const jobs = autoLive.map((l) =>
        timed(l.engine, l.stream.finish(LIVE_FINISH_MS))
      )
      // Known mistakes fixed first, so two engines sharing one still agree
      // on the right text
      const results = (await gatherAuto(jobs)).map((r) => ({
        ...r,
        text: applyFixes(r.text),
      }))
      const best = pickBest(results)
      const judgeStart = Date.now()
      const judged =
        best && (await judgeDictation(results, best.text, keyTerms()))
      text = withoutFillers(applyFixes(judged ?? best?.text ?? ''))
      // Logged once every engine has answered (or given up), so the ones
      // that lost the race still show what they heard
      void reportAuto(jobs, took, {
        sent: judged ? 'judge' : (best?.engine ?? 'none'),
        totalMs: Date.now() - stoppedAt,
        judgeMs: best ? Date.now() - judgeStart : undefined,
        judged,
      })
    }
    if (!autoLive)
      reportSpeech(
        `dictation ${engine}: ${Date.now() - stoppedAt} ms after stop, ${text.length} chars`
      )
    text = applyFixes(text)
  } catch (err) {
    // Every live engine failed: the batch route below gets the audio
    liveError = err as Error
  }
  try {
    if (!text) {
      const samples = concatSamples(audio)
      try {
        text = applyFixes(await transcribe(samples))
      } catch (err) {
        const why = (err as Error).message
        keepFailed(samples, liveError ? `${liveError.message}; ${why}` : why)
        return
      }
      reportSpeech(
        `dictation fallback (${liveError ? 'live failed' : 'live empty'}): ${Date.now() - stoppedAt} ms after stop, ${text.length} chars`
      )
    }
    if (text) deliverDictation(text)
    else toast(`${label} heard nothing`)
  } catch (err) {
    toast(`Dictation failed: ${(err as Error).message}`)
  } finally {
    useDictation.setState({ status: 'idle', level: 0 })
  }
}

/** Keeps a failed dictation's audio, so the banner can offer Retry. */
function keepFailed(samples: Float32Array, why: string) {
  failedAudio = samples
  useDictation.setState({ failed: why })
}

/** Sends the failed dictation's audio to the batch route again. */
export async function retryDictation() {
  const samples = failedAudio
  if (!samples || useDictation.getState().status !== 'idle') return
  useDictation.setState({ status: 'transcribing', level: 0 })
  try {
    const text = applyFixes(await transcribe(samples))
    dismissFailedDictation()
    if (text) deliverDictation(text)
    else toast('Dictation heard nothing')
  } catch (err) {
    keepFailed(samples, (err as Error).message)
  } finally {
    useDictation.setState({ status: 'idle', level: 0 })
  }
}

/** Throws the failed dictation's audio away. */
export function dismissFailedDictation() {
  failedAudio = undefined
  useDictation.setState({ failed: undefined })
}

/** How long the log waits for engines that lost the race. */
const REPORT_WAIT_MS = 10000

/**
 * One line per Auto dictation in the server log: what each engine heard
 * (including the ones that answered after the text was sent), how long
 * after you stopped it answered, and which text was sent.
 */
export async function reportAuto(
  jobs: { engine: DictationEngine; text: Promise<string> }[],
  took: Partial<Record<DictationEngine, number>>,
  info: { sent: string; totalMs: number; judgeMs?: number; judged?: string },
  waitMs = REPORT_WAIT_MS
) {
  const heard = new Map<DictationEngine, string>()
  let wait: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.allSettled(
      jobs.map(({ engine, text }) =>
        text.then(
          (t) => heard.set(engine, JSON.stringify(t.trim())),
          (err: Error) => heard.set(engine, `failed (${err.message})`)
        )
      )
    ),
    new Promise((r) => (wait = setTimeout(r, waitMs))),
  ])
  clearTimeout(wait)
  const engines = jobs.map((j) => j.engine)
  const times = engines
    .map((e) => `${e}=${took[e] !== undefined ? `${took[e]}ms` : 'none'}`)
    .join(' ')
  const texts = engines.map((e) => `${e}: ${heard.get(e) ?? '-'}`).join(' | ')
  reportSpeech(
    `dictation auto: sent=${info.sent} total=${info.totalMs}ms ${times}` +
      `${info.judgeMs !== undefined ? ` judge=${info.judgeMs}ms` : ''}` +
      ` | ${texts}${info.judged ? ` | judge: ${JSON.stringify(info.judged)}` : ''}`
  )
}

/** Throws the recording away without sending it. */
export function cancelDictation() {
  const { status } = useDictation.getState()
  if (status !== 'recording' && status !== 'starting') return
  generation++
  release()
  useDictation.setState({ status: 'idle', level: 0 })
}

export function toggleDictation() {
  const { status } = useDictation.getState()
  if (status === 'idle') void startDictation()
  else if (status === 'recording' || status === 'starting') void stopDictation()
}
