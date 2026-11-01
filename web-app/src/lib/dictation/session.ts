import { toast } from 'sonner'
import {
  TARGET_SAMPLE_RATE,
  VoiceLeveler,
  concatSamples,
  downsample,
  rms,
} from '@/lib/speechAudio'
import { keyTerms, reportSpeech } from '@/lib/speechServices'
import { applyFixes } from '@/lib/dictationFixes'
import { warmAnswer } from '@/lib/answerWarm'
import { useChatAuto } from '@/lib/chatModels'
import { findMicDevice, getDictationMic } from '@/lib/micActivity'
import { deliverDictation } from '@/lib/dictationDelivery'
import { judgeDictation, lastJudge, warmJudges } from '@/lib/dictationJudge'
import { withCodingTerms } from '@/lib/keyTerms'
import { openComputerAudio, usesComputerAudio } from '@/lib/computerAudio'
import { useDictationEnabled } from '@/hooks/useDictationEnabled'
import {
  DICTATION_ENGINES,
  KEEP_MIC_STORAGE_KEY,
  REDUCE_ECHO_STORAGE_KEY,
  getDictationEngine,
  getDictationReduceEcho,
  getKeepMicReady,
  type DictationEngine,
} from './settings'
import { liveStream, transcribe } from './engines'
import {
  AUTO_DEADLINE_MS,
  JUDGE_DEADLINE_MS,
  JUDGE_FLOOR_MS,
  MIN_JUDGE_MS,
  autoLiveStreams,
  countedEngines,
  fastAgreement,
  gatherAuto,
  longestAgreeing,
  pickBest,
  trimStrayStart,
  withoutFillers,
} from './auto'
import {
  MAX_DICTATION_MS,
  MIN_DICTATION_MS,
  SOUND_RMS,
  silentTooLong,
  useDictation,
  type Recording,
} from './state'

/**
 * Dictation: speech heard by your selected microphone, streamed to live
 * speech-to-text engines while you record. Playback suppression is off by default.
 * Stopping dictation delivers the text to the chat.
 */

export function setDictationReduceEcho(on: boolean) {
  try {
    localStorage.setItem(REDUCE_ECHO_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    /* Storage blocked */
  }
  switchMic()
}

/** Dictation turned off on this device: the open mic is let go. */
export function letGoOfMic() {
  if (!recording) closeMic()
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

/** The audio of the dictation that failed, until it is retried or dismissed. */
let failedAudio: Float32Array | undefined

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

let recording: Recording | undefined

/**
 * The open mic, or the computer's sound (see computerAudio.ts), kept between
 * dictations when "keep the mic ready" is on.
 */
type Mic = {
  /** The sample rate of its blocks */
  rate: number
  alive: () => boolean
  close: () => void
  /** The last moments before a dictation starts, so no first word is lost */
  preroll: Float32Array[]
  /** The Microphone setting it was opened for, or COMPUTER */
  device: string
  /** Which input that was (its group), to notice when the default changes */
  deviceKey?: string
  reduceEcho: boolean
}
let mic: Mic | undefined
const PREROLL_BLOCKS = 3 // ~130 ms at 48 kHz

/** Mic.device for the computer's sound */
const COMPUTER = '\0computer'

/** What dictation should record from now: COMPUTER or the Microphone setting. */
const wantedDevice = () => (usesComputerAudio() ? COMPUTER : getDictationMic())

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

/** Computer audio couldn't start this session: said once, then the mic. */
let computerFailed = false

/** The computer's sound, from the app. */
async function openComputer(): Promise<Mic> {
  const m: Mic = {
    rate: 0,
    alive: () => false,
    close: () => {},
    preroll: [],
    device: COMPUTER,
    reduceEcho: getDictationReduceEcho(),
  }
  const audio = await openComputerAudio((block) => {
    if (recording && mic === m) return onBlock(recording, block)
    m.preroll.push(block)
    if (m.preroll.length > PREROLL_BLOCKS) m.preroll.shift()
  })
  m.rate = audio.rate
  m.alive = audio.alive
  m.close = audio.close
  computerFailed = false
  return m
}

// A new audio context each time the mic opens, made once the mic is open
// (Safari doesn't reliably restart a suspended one, so it's never suspended).
async function openMic(): Promise<Mic> {
  if (usesComputerAudio()) {
    takeEarlyStream()
      ?.stream.getTracks()
      .forEach((t) => t.stop())
    try {
      return await openComputer()
    } catch (err) {
      if (!computerFailed)
        toast(
          `Computer audio unavailable, using the microphone: ${(err as Error).message}`
        )
      computerFailed = true
    }
  }
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
    rate: ctx.sampleRate,
    alive: () =>
      ctx.state === 'running' &&
      stream.getAudioTracks().some((t) => t.readyState === 'live'),
    close: () => {
      tap.port.onmessage = null
      tap.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      ctx.close().catch(() => {})
    },
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
  mic.close()
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
  const wanted = wantedDevice()
  // Computer audio failed this session: the mic it fell back to will do
  const fellBack = wanted === COMPUTER && computerFailed
  return (
    m.alive() &&
    (m.device === wanted || (fellBack && m.device === getDictationMic())) &&
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

/**
 * The Mac and Windows apps allow the mic for Hi-chat themselves, without
 * asking, but their web views still report it as "prompt". Taking that at
 * its word left the mic shut until the first dictation, which then lost its
 * first words while the mic opened.
 */
const inHiChatApp = () =>
  typeof navigator !== 'undefined' &&
  /HiChat(Mac|Windows)/.test(navigator.userAgent)

async function micAllowed(): Promise<boolean> {
  if (inHiChatApp()) return true
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
  if (!useDictationEnabled.getState().on) return
  readied = true
  if (!navigator.mediaDevices?.getUserMedia) return
  if (typeof AudioWorkletNode === 'undefined') return
  const wanted = async () =>
    useDictationEnabled.getState().on &&
    getKeepMicReady() &&
    (await micAllowed())
  void wanted().then(async (yes) => {
    if (!yes || early || mic || opening) return
    // The computer's sound needs no click first, and no mic
    if (usesComputerAudio()) {
      ensureMic().catch(() => {})
      return
    }
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
    if (recording || opening || !mic || mic.device === COMPUTER) return
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
 * The voice level the breathing dot follows, rounded so the page only
 * redraws when the dot visibly changes (not ~23 times a second).
 */
export function dotLevel(block: Float32Array): number {
  return Math.round(Math.min(1, rms(block) * 8) * 10) / 10
}

/** Takes one block from the mic; exported for tests. */
export function onBlock(rec: Recording, block: Float32Array) {
  const loudness = rms(block)
  const level = Math.round(Math.min(1, loudness * 8) * 10) / 10
  if (useDictation.getState().level !== level) useDictation.setState({ level })
  const now = Date.now()
  if (rec.lastSound === undefined || loudness >= SOUND_RMS) rec.lastSound = now
  else if (rec === recording && !rec.autoStopped && silentTooLong(rec, now)) {
    rec.autoStopped = true
    toast('Dictation stopped after 2 minutes of silence')
    void stopDictation()
  }
  const sound = rec.leveler ? rec.leveler.process(block) : block
  const down = downsample(sound, rec.rate / TARGET_SAMPLE_RATE)
  rec.audio.push(down)
  rec.live?.push(down)
  rec.autoLive?.forEach((l) => l.stream.push(down))
}

/** Where the last dictation was recorded from, for the speech log */
let recordedFrom: 'computer' | 'mic' = 'mic'

function begin(m: Mic) {
  const engine = getDictationEngine()
  recordedFrom = m.device === COMPUTER ? 'computer' : 'mic'
  const rec: Recording = {
    rate: m.rate,
    leveler: m.device === COMPUTER ? new VoiceLeveler(m.rate) : undefined,
    engine,
    live: liveStream(engine),
    autoLive: engine === 'auto' ? autoLiveStreams() : undefined,
    heardLive: new Map(),
    audio: [],
    limit: setTimeout(() => void stopDictation(), MAX_DICTATION_MS),
    lastSound: Date.now(),
  }
  rec.autoLive?.forEach(({ engine, stream }) =>
    stream.setPreviewListener?.((text) => rec.heardLive?.set(engine, text))
  )
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
  if (!useDictationEnabled.getState().on) {
    toast(
      'Dictation is off on this device: turn it on with the mic in the chat header'
    )
    return
  }
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof AudioWorkletNode === 'undefined'
  ) {
    toast('This browser cannot record the microphone')
    return
  }
  if (getDictationEngine() === 'auto') warmJudges()
  warmAnswer()
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
  const { engine, live, autoLive, audio, heardLive } = recording
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
  // The question goes out in a moment: make sure the answer's connections are open
  warmAnswer({ soon: true })
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
      const counted = countedEngines(jobs)
      const gathered = gatherAuto(counted, AUTO_DEADLINE_MS)
      const { auto: chatAuto, mode: chatMode } = useChatAuto.getState()
      const fast =
        chatAuto && chatMode === 'instant'
          ? await Promise.race([
              fastAgreement(counted, heardLive),
              gathered.then(
                () => undefined,
                () => undefined
              ),
            ])
          : undefined
      if (fast) {
        gathered.catch(() => {})
        text = withoutFillers(applyFixes(fast.text))
        void reportAuto(jobs, took, {
          // e.g. fast-cartesia-soniox-live: Cartesia's final matched Soniox's live text
          sent: `fast-${fast.engine}-${fast.with}${fast.live ? '-live' : ''}`,
          totalMs: Date.now() - stoppedAt,
        })
      }
      // Known mistakes fixed first, so two engines sharing one still agree
      // on the right text
      const results = fast
        ? []
        : trimStrayStart(
            (await gathered).map((r) => ({
              ...r,
              text: applyFixes(r.text),
            }))
          )
      // Past the deadline some engines may have been cut off: the longest
      // text that agrees with the vote is the whole question
      const best = fast
        ? undefined
        : Date.now() - stoppedAt > AUTO_DEADLINE_MS
          ? longestAgreeing(results, pickBest(results))
          : pickBest(results)
      const judgeStart = Date.now()
      const elapsed = judgeStart - stoppedAt
      const judgeMs = Math.min(
        Math.max(AUTO_DEADLINE_MS - elapsed, JUDGE_FLOOR_MS),
        JUDGE_DEADLINE_MS - elapsed
      )
      const judged =
        best && judgeMs >= MIN_JUDGE_MS
          ? await judgeDictation(
              results,
              best.text,
              withCodingTerms(keyTerms()),
              undefined,
              judgeMs
            )
          : undefined
      if (!fast) text = withoutFillers(applyFixes(judged ?? best?.text ?? ''))
      // Logged once every engine has answered (or given up), so the ones
      // that lost the race still show what they heard
      if (!fast)
        void reportAuto(jobs, took, {
          sent: judged
            ? `judge(${lastJudge?.model ?? '?'} ${lastJudge?.ms ?? '?'}ms)`
            : (best?.engine ?? 'none'),
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
    if (text) deliverDictation(text, stoppedAt)
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
    `dictation auto: sent=${info.sent} total=${info.totalMs}ms from=${recordedFrom} ${times}` +
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
