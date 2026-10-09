import {
  PauseDetector,
  TARGET_SAMPLE_RATE,
  WAIT_MODE_END_MS,
  concatSamples,
  downsample,
  findSpeakerDevice,
  rms,
} from './speakerCapture'
import { encodeFlac } from './flacEncoder'
import {
  AssemblyLiveTranscriber,
  GrokLiveTranscriber,
  LiveTranscriber,
  getLiveMode,
} from './speakerLive'
import { getWaitMode, wordCount } from './speakerFilter'
import type { SpeakerStatus } from '@/hooks/useSpeakerTranscription'
import type { TurnCheck } from './smartTurn'

/**
 * Puts Grok's transcript first, so it is the one sent when the judge doesn't
 * pick a wording: across three interviews it got tech terms right (JMeter,
 * assert, NAT gateway) where ElevenLabs didn't. Grok sometimes drops the
 * first word, so ElevenLabs stays first when Grok's text is clearly shorter.
 */
export function grokFirst(texts: string[], names: string[]): string[] {
  const g = names.findIndex((n) => n.startsWith('grok'))
  if (g <= 0 || !texts[g]?.trim()) return texts
  if (wordCount(texts[g]) < wordCount(texts[0]) * 0.8) return texts
  return [texts[g], ...texts.filter((_, i) => i !== g)]
}

/**
 * Same-origin relay (relay/server.mjs). Each clip is uploaded once; the server
 * sends it to the chosen engines at the same time and adds their API keys,
 * so the keys never reach the browser.
 */
export const TRANSCRIBE_URL = '/api/transcribe'

/**
 * The relay only answers requests carrying the RELAY_TOKEN set on the server,
 * so strangers can't spend the API keys. The token is asked for once and kept
 * in this browser.
 */
export const RELAY_TOKEN_STORAGE_KEY = 'speaker-relay-token'
export const RELAY_TOKEN_HEADER = 'X-Relay-Token'

export function relayToken(): string {
  let token = ''
  try {
    token = localStorage.getItem(RELAY_TOKEN_STORAGE_KEY) ?? ''
  } catch {
    // Storage blocked: ask every time
  }
  if (!token && typeof window !== 'undefined' && window.prompt) {
    const answer = window.prompt(
      'Speaker relay token (the RELAY_TOKEN variable on Railway):'
    )
    token = (answer ?? '').trim()
    if (token) {
      try {
        localStorage.setItem(RELAY_TOKEN_STORAGE_KEY, token)
      } catch {
        // Storage blocked: ask again next time
      }
    }
  }
  return token
}

/**
 * Which engines transcribe speaker clips. ElevenLabs always runs; a second
 * transcript gives the relevance check something to merge with it. "live"
 * (with live mode on) streams to Grok beside ElevenLabs, so both transcripts
 * arrive together at the pause; "live-assemblyai" streams to AssemblyAI as
 * well, for three.
 * "race" uploads to Grok and AssemblyAI and keeps the first; the others pick
 * one partner or none. Kept in this browser.
 */
export type TranscribeMode =
  | 'live'
  | 'live-assemblyai'
  | 'race'
  | 'grok'
  | 'assemblyai'
  | 'elevenlabs'
export const TRANSCRIBE_MODE_STORAGE_KEY = 'speaker-transcribe-mode'

export const TRANSCRIBE_MODES: { value: TranscribeMode; label: string }[] = [
  { value: 'live', label: 'Grok live' },
  { value: 'live-assemblyai', label: 'AssemblyAI live + Grok live' },
  { value: 'race', label: 'Race: Grok + AssemblyAI' },
  { value: 'grok', label: 'Grok Voice Transcribe 2.0' },
  { value: 'assemblyai', label: 'AssemblyAI Universal-3.5 Pro' },
  { value: 'elevenlabs', label: 'None (ElevenLabs only)' },
]

/** The relay engines for each mode, in the order transcripts are merged. */
const MODE_ENGINES: Record<TranscribeMode, string[]> = {
  // Grok (and AssemblyAI) stream instead when live mode is on (see grokLive)
  'live': ['elevenlabs', 'grok'],
  'live-assemblyai': ['elevenlabs', 'grok'],
  'race': ['elevenlabs', 'grok', 'assemblyai'],
  'grok': ['elevenlabs', 'grok'],
  'assemblyai': ['elevenlabs', 'assemblyai'],
  'elevenlabs': ['elevenlabs'],
}

/** Engines that answer within SECOND_ENGINE_WAIT_MS of ElevenLabs. */
const FAST_ENGINES = ['grok', 'assemblyai']

/** How long to wait for the second engine once ElevenLabs has answered. */
export const SECOND_ENGINE_WAIT_MS = 1000

export function getTranscribeMode(): TranscribeMode {
  try {
    const saved = localStorage.getItem(TRANSCRIBE_MODE_STORAGE_KEY)
    return TRANSCRIBE_MODES.some((m) => m.value === saved)
      ? (saved as TranscribeMode)
      : 'live'
  } catch {
    return 'live'
  }
}

export function setTranscribeMode(mode: TranscribeMode) {
  try {
    localStorage.setItem(TRANSCRIBE_MODE_STORAGE_KEY, mode)
  } catch {
    // Storage blocked: the default (live) stays in effect
  }
}

/** The other engines for the current mode (raced beside live mode). */
export function otherEngines(): string[] {
  return MODE_ENGINES[getTranscribeMode()].filter((e) => e !== 'elevenlabs')
}

/** Where the key terms for Grok live come from (set by the speaker UI). */
let keyTermsSource: () => string[] = () => []
export function setKeyTermsSource(source: () => string[]) {
  keyTermsSource = source
}
export function keyTerms(): string[] {
  return keyTermsSource()
}

/** Live mode with Grok streaming beside ElevenLabs. */
export function grokLive(): boolean {
  const mode = getTranscribeMode()
  return getLiveMode() && (mode === 'live' || mode === 'live-assemblyai')
}

/** Live mode with AssemblyAI streaming too. */
export function assemblyLive(): boolean {
  return getLiveMode() && getTranscribeMode() === 'live-assemblyai'
}

function forgetRelayToken() {
  try {
    localStorage.removeItem(RELAY_TOKEN_STORAGE_KEY)
  } catch {
    // Nothing stored
  }
}

function relayPost(url: string, body: FormData): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    body,
    headers: { [RELAY_TOKEN_HEADER]: relayToken() },
  })
}

const RELAY_TOKEN_ERROR =
  'Relay token missing or wrong; you will be asked for it on the next clip'

/** nginx marks the responses where it, not the engine, refused the request. */
function relayRejected(res: Response): 'token' | 'unset' | null {
  const flag = res.headers.get('X-Relay-Rejected')
  if (!flag) return null
  if (flag === 'unset') return 'unset'
  forgetRelayToken()
  return 'token'
}

/** Each judged clip is reported here so it shows in the server's logs. */
export const SPEAKER_LOG_URL = '/api/speaker-log'

/** Sends one clip line to the server log; never prompts and never throws. */
export function reportClip(line: string) {
  let token = ''
  try {
    token = localStorage.getItem(RELAY_TOKEN_STORAGE_KEY) ?? ''
  } catch {
    // Storage blocked: nothing to authenticate with
  }
  if (!token) return
  fetch(SPEAKER_LOG_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [RELAY_TOKEN_HEADER]: token,
    },
    body: JSON.stringify({ line }),
    keepalive: true,
  }).catch(() => {})
}

/**
 * Live mode: the relay hands out single-use ElevenLabs streaming tokens, or
 * AssemblyAI ones ({"engine":"assemblyai"}), or tickets for its own Grok live
 * socket ({"engine":"grok"}).
 */
type LiveEngine = 'elevenlabs' | 'assemblyai' | 'grok'
export const LIVE_TOKEN_URL = '/api/live-token'
/** Tokens last 15 minutes; a spare older than this is replaced. */
const LIVE_TOKEN_MAX_AGE_MS = 10 * 60 * 1000

export async function fetchLiveToken(
  engine: LiveEngine = 'elevenlabs'
): Promise<string> {
  const res = await fetch(LIVE_TOKEN_URL, {
    method: 'POST',
    headers: {
      [RELAY_TOKEN_HEADER]: relayToken(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ engine }),
  })
  const rejected = relayRejected(res)
  if (rejected === 'token') throw new Error(RELAY_TOKEN_ERROR)
  if (rejected === 'unset') {
    throw new Error('RELAY_TOKEN is not set on the server')
  }
  if (!res.ok) throw new Error(`Live token failed (${res.status})`)
  return ((await res.json()) as { token: string }).token
}

/** Audio kept from just before speech is detected, so first words aren't clipped. */
const PREROLL_MS = 400

// Copies the input to the main thread in ~40 ms blocks (runs on the audio
// thread, so it keeps working while the tab is in the background).
const TAP_WORKLET = `
class SpeakerTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0 }
  process(inputs) {
    const chans = inputs[0]
    if (chans && chans.length) {
      // Sound arrives on channels 1-2; extra BlackHole channels are silent.
      const len = chans[0].length
      const used = Math.min(2, chans.length)
      for (let i = 0; i < len; i++) {
        let s = 0
        for (let c = 0; c < used; c++) s += chans[c][i]
        this.buf[this.n++] = s / used
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
registerProcessor('speaker-tap', SpeakerTap)
`

type Callbacks = {
  onStatus: (status: SpeakerStatus, error?: string) => void
  onText: (text: string) => void
  /**
   * Gets every engine's transcript of a clip (Grok first when it heard it all) and returns the
   * text to send, or null to drop the clip.
   */
  accept?: (
    transcripts: string[],
    timings: EngineTiming[],
    // Each engine's own words, for the log
    words?: { name: string; text: string }[],
    // How finished the speaker's turn sounded when the clip ended
    turn?: TurnCheck | null
  ) => Promise<string | null>
  /** The call's level (RMS, 0-1) for each block of loopback audio. */
  onLevel?: (level: number) => void
  /** Every block of loopback audio at 16 kHz (for Smart Turn). */
  onAudio?: (samples: Float32Array) => void
  /** Asked when a clip ends; runs while the clip is transcribed. */
  checkTurn?: () => Promise<TurnCheck | null>
}

/** How long one engine took on a clip, and whether it answered. */
export type EngineTiming = { name: string; ms: number; ok: boolean }

type EngineResult = EngineTiming & {
  text?: string
  error?: string
  off?: boolean
}

/**
 * Uploads the clip once. The server runs the chosen engines that have a key
 * and returns each one's result in merge order. Resolves with the transcripts that arrived;
 * throws if none did.
 */
export async function transcribeClip(
  audio: Blob,
  engines: string[] = MODE_ENGINES[getTranscribeMode()],
  // Return as soon as this many engines answered; two is enough to merge
  need = 2
): Promise<{ texts: string[]; timings: EngineTiming[] }> {
  const form = new FormData()
  form.append('file', audio, 'speaker.flac')
  form.append('engines', engines.join(','))
  if (engines.length > need) form.append('need', String(need))
  // Grok and AssemblyAI answer about when ElevenLabs does, so a short wait
  // is enough
  if (engines.some((e) => FAST_ENGINES.includes(e)))
    form.append('wait_ms', String(SECOND_ENGINE_WAIT_MS))
  const res = await relayPost(TRANSCRIBE_URL, form)
  const rejected = relayRejected(res)
  if (rejected === 'token') throw new Error(RELAY_TOKEN_ERROR)
  if (rejected === 'unset') {
    throw new Error('RELAY_TOKEN is not set on the server')
  }
  let results: EngineResult[] = []
  try {
    results = ((await res.json()) as { results?: EngineResult[] }).results ?? []
  } catch {
    // Not the relay's JSON (e.g. a proxy error page)
  }
  if (res.status === 503 && results.every((r) => r.off)) {
    throw new Error('No transcription key set (ELEVENLABS_API_KEY)')
  }
  const answered = results.filter((r) => r.ok && r.text !== undefined)
  if (!answered.length) {
    const reason = results.find((r) => !r.off)?.error
    throw new Error(reason ?? `Transcription failed (${res.status})`)
  }
  return {
    texts: answered.map((r) => r.text!),
    timings: results
      .filter((r) => !r.off)
      .map(({ name, ms, ok }) => ({ name, ms, ok })),
  }
}

/**
 * Listens to the BlackHole loopback device and hands each transcribed
 * utterance to `onText`. Never records the built-in microphone.
 */
export function startSpeakerCapture({
  onStatus,
  onText,
  accept = async (texts) => texts[0] ?? null,
  onLevel,
  onAudio,
  checkTurn,
}: Callbacks) {
  let stopped = false
  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let queue: Promise<void> = Promise.resolve()
  let pending = 0
  let speaking = false
  const cleanups: (() => void)[] = []

  const media =
    typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined

  const idleStatus = () => {
    if (!ctx) return
    if (ctx.state !== 'running') onStatus('needs-click')
    else if (speaking) onStatus('hearing')
    else if (pending > 0) onStatus('transcribing')
    else onStatus('listening')
  }

  // Live mode keeps one token in hand so a new utterance can connect at once.
  const tokenPool = (engine: LiveEngine, maxAge: number) => {
    let spare: { token: Promise<string>; at: number } | null = null
    const fetchOne = () => {
      const token = fetchLiveToken(engine)
      token.catch(() => {})
      return { token, at: Date.now() }
    }
    return {
      warm() {
        spare = fetchOne()
      },
      take() {
        const fresh =
          spare && Date.now() - spare.at < maxAge
            ? spare.token
            : fetchLiveToken(engine)
        spare = fetchOne()
        return fresh
      },
    }
  }
  const elevenTokens = tokenPool('elevenlabs', LIVE_TOKEN_MAX_AGE_MS)
  // AssemblyAI tokens must be redeemed within 10 minutes
  const assemblyTokens = tokenPool('assemblyai', 8 * 60 * 1000)
  // Grok live tickets also last 10 minutes
  const grokTickets = tokenPool('grok', 8 * 60 * 1000)

  const send = (
    samples: Float32Array,
    live: LiveTranscriber | null,
    second: AssemblyLiveTranscriber | null,
    third: GrokLiveTranscriber | null,
    turnCheck: Promise<TurnCheck | null> = Promise.resolve(null)
  ) => {
    // Ignore clips too short to hold a word.
    if (samples.length < TARGET_SAMPLE_RATE * 0.4) {
      live?.abort()
      second?.abort()
      third?.abort()
      return
    }
    // Lossless FLAC is about half the size of WAV, so it uploads faster.
    let flac: Blob | null = null
    const audio = () => (flac ??= encodeFlac(samples, TARGET_SAMPLE_RATE))
    const upload = () => transcribeClip(audio())
    // Live: commit now, so the text is ready by the time earlier clips are
    // done. If streaming fails, the clip is uploaded as usual.
    const committedAt = Date.now()
    // Beside live mode the other engines get the clip at the same moment
    // (AssemblyAI and Grok live are already streaming); whatever arrives within
    // SECOND_ENGINE_WAIT_MS of the ElevenLabs text is used.
    if (!live) {
      second?.abort()
      third?.abort()
    }
    type Extra = { texts: string[]; timings: EngineTiming[] }
    const extras: { names: string[]; result: Promise<Extra | null> }[] = []
    const streamed = (
      name: string,
      stream: { finish(): Promise<string> }
    ): Promise<Extra | null> =>
      stream.finish().then(
        (text) => ({
          texts: [text],
          timings: [{ name, ms: Date.now() - committedAt, ok: true }],
        }),
        (err: Error) => {
          console.warn(`[speaker] ${name} failed: ${err.message}`)
          return null
        }
      )
    if (live && second)
      extras.push({
        names: ['assemblyai live'],
        result: streamed('assemblyai live', second),
      })
    if (live && third)
      extras.push({
        names: ['grok live'],
        result: streamed('grok live', third),
      })
    // Grok streams in live mode, so it isn't uploaded as well
    const others = live
      ? otherEngines().filter((e) => !(third && e === 'grok'))
      : []
    if (others.length)
      extras.push({
        names: others,
        result: transcribeClip(audio(), others, 1).catch(() => null),
      })
    const result = live
      ? live.finish().then(
          async (text) => {
            const texts = [text]
            const timings: EngineTiming[] = [
              {
                name: 'elevenlabs live',
                ms: Date.now() - committedAt,
                ok: true,
              },
            ]
            const late = new Promise<null>((r) =>
              setTimeout(() => r(null), SECOND_ENGINE_WAIT_MS)
            )
            const more = await Promise.all(
              extras.map((e) => Promise.race([e.result, late]))
            )
            more.forEach((m, i) => {
              if (m) {
                texts.push(...m.texts)
                timings.push(...m.timings)
              } else {
                for (const name of extras[i].names)
                  timings.push({
                    name,
                    ms: Date.now() - committedAt,
                    ok: false,
                  })
              }
            })
            return { texts, timings }
          },
          (err: Error) => {
            console.warn(
              `[speaker] live failed, uploading clip: ${err.message}`
            )
            return upload()
          }
        )
      : null
    result?.catch(() => {})
    pending++
    idleStatus()
    // Sequential, so text lands in the order it was spoken.
    queue = queue
      .then(() => result ?? upload())
      .then(async ({ texts, timings }) => {
        // Answered engines line up with the transcripts, in order
        const words = timings
          .filter((t) => t.ok)
          .map((t, i) => ({ name: t.name, text: texts[i] ?? '' }))
        const heard = grokFirst(
          texts,
          words.map((w) => w.name)
        ).filter((t) => t.trim())
        const turn = await turnCheck
        const text =
          !stopped && heard.length
            ? await accept(heard, timings, words, turn)
            : null
        if (!stopped && text) onText(text)
        pending--
        if (!stopped) idleStatus()
      })
      .catch((err: Error) => {
        pending--
        if (!stopped) onStatus('error', err.message)
      })
  }

  const findDevice = async () => {
    let devices = await media!.enumerateDevices()
    let device = findSpeakerDevice(devices)
    if (!device && !devices.some((d) => d.label)) {
      // Device names stay hidden until audio permission is granted. Ask once,
      // close the stream straight away, and look again.
      const probe = await media!.getUserMedia({ audio: true })
      probe.getTracks().forEach((t) => t.stop())
      devices = await media!.enumerateDevices()
      device = findSpeakerDevice(devices)
    }
    return device
  }

  // Each open() gets a number; a newer open() or close() makes older ones
  // give up, so only one capture ever runs (otherwise every clip is sent twice).
  let generation = 0
  let opening = false
  let openedAt = 0

  const open = async () => {
    const gen = ++generation
    const stale = () => stopped || gen !== generation
    if (!media?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      onStatus('unsupported')
      return
    }
    opening = true
    try {
      onStatus('starting')
      let device: MediaDeviceInfo | undefined
      try {
        device = await findDevice()
      } catch {
        if (!stale()) onStatus('blocked')
        return
      }
      if (stale()) return
      if (!device) {
        onStatus('no-device')
        return
      }

      let ownStream: MediaStream
      try {
        ownStream = await media.getUserMedia({
          audio: {
            deviceId: { exact: device.deviceId },
            // Keep the loopback signal untouched.
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        })
      } catch {
        if (!stale()) onStatus('blocked')
        return
      }
      if (stale()) {
        ownStream.getTracks().forEach((t) => t.stop())
        return
      }

      const ownCtx = new AudioContext()
      const url = URL.createObjectURL(
        new Blob([TAP_WORKLET], { type: 'application/javascript' })
      )
      try {
        await ownCtx.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      if (stale()) {
        ownStream.getTracks().forEach((t) => t.stop())
        ownCtx.close().catch(() => {})
        return
      }
      stream = ownStream
      ctx = ownCtx

      const source = ownCtx.createMediaStreamSource(ownStream)
      const tap = new AudioWorkletNode(ownCtx, 'speaker-tap')
      source.connect(tap)
      // Outputs silence; the connection just keeps the node running.
      tap.connect(ownCtx.destination)

      const rate = ownCtx.sampleRate
      const ratio = rate / TARGET_SAMPLE_RATE
      const detector = new PauseDetector(
        getWaitMode() ? { endMs: WAIT_MODE_END_MS } : {}
      )
      const preroll: Float32Array[] = []
      let prerollLen = 0
      let utterance: Float32Array[] | null = null
      let live: LiveTranscriber | null = null
      let second: AssemblyLiveTranscriber | null = null
      let third: GrokLiveTranscriber | null = null
      let clock = 0
      if (getLiveMode()) elevenTokens.warm()
      if (grokLive()) grokTickets.warm()
      if (assemblyLive()) assemblyTokens.warm()

      tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (stale()) return
        const block = e.data
        clock += (block.length / rate) * 1000
        const small = downsample(block, ratio)
        const level = rms(block)
        onLevel?.(level)
        onAudio?.(small)
        const event = detector.feed(level, clock)

        if (event === 'start') {
          utterance = [...preroll]
          if (getLiveMode()) {
            live = new LiveTranscriber(elevenTokens.take())
            preroll.forEach((chunk) => live!.push(chunk))
          }
          if (assemblyLive()) {
            second = new AssemblyLiveTranscriber(assemblyTokens.take())
            preroll.forEach((chunk) => second!.push(chunk))
          }
          if (grokLive()) {
            third = new GrokLiveTranscriber(
              grokTickets.take(),
              undefined,
              undefined,
              keyTermsSource()
            )
            preroll.forEach((chunk) => third!.push(chunk))
          }
          speaking = true
          idleStatus()
        }
        if (utterance) {
          utterance.push(small)
          live?.push(small)
          second?.push(small)
          third?.push(small)
        } else {
          preroll.push(small)
          prerollLen += small.length
          while (prerollLen > (TARGET_SAMPLE_RATE * PREROLL_MS) / 1000) {
            prerollLen -= preroll.shift()!.length
          }
        }
        if (event === 'end' && utterance) {
          send(
            concatSamples(utterance),
            live,
            second,
            third,
            checkTurn?.() ?? Promise.resolve(null)
          )
          live = null
          second = null
          third = null
          utterance = null
          preroll.length = 0
          prerollLen = 0
          speaking = false
          idleStatus()
        }
      }

      // Browsers keep audio paused until the page has been clicked or typed in.
      const resume = () => {
        if (ownCtx.state !== 'running') ownCtx.resume().catch(() => {})
      }
      document.addEventListener('pointerdown', resume, true)
      document.addEventListener('keydown', resume, true)
      cleanups.push(() => {
        document.removeEventListener('pointerdown', resume, true)
        document.removeEventListener('keydown', resume, true)
      })
      cleanups.push(() => live?.abort())
      cleanups.push(() => second?.abort())
      cleanups.push(() => third?.abort())
      ownCtx.onstatechange = () => {
        if (!stale()) idleStatus()
      }
      resume()
      idleStatus()

      // BlackHole removed or switched off: start over when devices change.
      ownStream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (!stale()) restart()
      })
    } finally {
      if (gen === generation) {
        opening = false
        openedAt = Date.now()
      }
    }
  }

  const close = () => {
    generation++
    opening = false
    cleanups.splice(0).forEach((fn) => fn())
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    ctx?.close().catch(() => {})
    ctx = null
    speaking = false
  }

  const restart = () => {
    close()
    open().catch((err: Error) => !stopped && onStatus('error', err.message))
  }

  // Pick up BlackHole if it is installed or reconnected while the page is open.
  // The permission probe itself fires devicechange, so ignore it while
  // opening and just after.
  const onDeviceChange = () => {
    if (stopped || stream || opening || Date.now() - openedAt < 2000) return
    restart()
  }
  media?.addEventListener?.('devicechange', onDeviceChange)

  open().catch((err: Error) => !stopped && onStatus('error', err.message))

  return {
    stop() {
      stopped = true
      media?.removeEventListener?.('devicechange', onDeviceChange)
      close()
    },
  }
}
