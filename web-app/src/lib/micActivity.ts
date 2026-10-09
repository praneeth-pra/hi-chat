import { SPEAKER_DEVICE_PATTERN } from '@/lib/speakerCapture'

/**
 * Watches your own microphone only for whether you are talking: the level is
 * read in the browser, nothing is recorded, transcribed or sent. The speaker
 * uses it to tell when the interviewer's question is over: everything they
 * say before you start answering is one question.
 */

export const MIC_TURNS_STORAGE_KEY = 'speaker-mic-turns'

/** Settings > Speaker: "Use my microphone to tell when a question is over". On by default. */
export function getMicTurns(): boolean {
  try {
    return localStorage.getItem(MIC_TURNS_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setMicTurns(on: boolean) {
  try {
    localStorage.setItem(MIC_TURNS_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Storage blocked: the default stays in effect
  }
}

/**
 * Settings > Speaker: which microphone to watch, by its name (device ids can
 * change between sessions). Empty means the Mac's default input.
 */
export const MIC_DEVICE_STORAGE_KEY = 'speaker-mic-device'

export function getMicDevice(): string {
  try {
    return localStorage.getItem(MIC_DEVICE_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setMicDevice(label: string) {
  try {
    localStorage.setItem(MIC_DEVICE_STORAGE_KEY, label)
  } catch {
    // Storage blocked: the default input stays in use
  }
}

/** The microphones you can pick (never the loopback), by name. */
export async function listMics(): Promise<string[]> {
  const media = navigator.mediaDevices
  if (!media?.enumerateDevices) return []
  let devices = await media.enumerateDevices()
  if (!devices.some((d) => d.kind === 'audioinput' && d.label)) {
    // Names stay hidden until audio permission is granted: ask once
    const probe = await media.getUserMedia({ audio: true })
    probe.getTracks().forEach((t) => t.stop())
    devices = await media.enumerateDevices()
  }
  const names = devices
    .filter(
      (d) =>
        d.kind === 'audioinput' &&
        d.label &&
        d.deviceId !== 'default' &&
        d.deviceId !== 'communications' &&
        !SPEAKER_DEVICE_PATTERN.test(d.label)
    )
    .map((d) => d.label)
  return [...new Set(names)]
}

/**
 * You count as talking after this much sound above the noise floor within
 * SPEAKING_WINDOW_MS, so a short "okay" or "mm-hmm" while the interviewer
 * pauses doesn't end their question, but the gaps between words don't matter.
 */
export const SPEAKING_MS = 1000
export const SPEAKING_WINDOW_MS = 2000
const FRAME_MS = 50
/** Sound this many times the room's noise floor (and above MIN_LEVEL) is speech. */
const NOISE_FACTOR = 3
const MIN_LEVEL = 0.01

/**
 * The microphone to watch: the one picked in Settings when it is plugged in,
 * else the default input unless it is the loopback.
 */
export function findMicDevice<
  T extends Pick<MediaDeviceInfo, 'kind' | 'label' | 'deviceId'>,
>(devices: T[], preferred = ''): T | undefined {
  const inputs = devices.filter(
    (d) => d.kind === 'audioinput' && !SPEAKER_DEVICE_PATTERN.test(d.label)
  )
  return (
    (preferred ? inputs.find((d) => d.label === preferred) : undefined) ??
    inputs.find((d) => d.deviceId === 'default') ??
    inputs.find((d) => d.deviceId !== 'communications') ??
    inputs[0]
  )
}

/**
 * Tracks talking from a stream of levels (RMS, 0-1), one per frame. The noise
 * floor follows the quietest recent level, so a fan or the room doesn't count.
 * Sound while `othersTalking()` is ignored: with laptop speakers the mic also
 * hears the interviewer.
 */
export function createSpeechDetector(
  now: () => number = Date.now,
  othersTalking: () => boolean = () => false
) {
  let floor = MIN_LEVEL
  // Loud or not for each frame in the window, oldest first
  const recent: boolean[] = []
  let spokeAt = 0
  return {
    push(level: number) {
      // Fall to quieter levels at once, rise slowly
      floor = level < floor ? level : floor + (level - floor) * 0.01
      const loud =
        level > Math.max(MIN_LEVEL, floor * NOISE_FACTOR) && !othersTalking()
      recent.push(loud)
      if (recent.length > SPEAKING_WINDOW_MS / FRAME_MS) recent.shift()
      const loudMs = recent.filter(Boolean).length * FRAME_MS
      if (loud && loudMs >= SPEAKING_MS) spokeAt = now()
    },
    /** When you were last heard talking (0 if never). */
    spokeAt: () => spokeAt,
  }
}

export type MicActivity = {
  /** When you were last heard talking; 0 if never, or if the mic isn't on. */
  spokeAt: () => number
  /** True once the microphone is being watched. */
  on: () => boolean
  stop: () => void
}

/** The call counts as talking for this long after its last loud block (echo, reverb). */
export const ECHO_MS = 400

/**
 * Times when the call (the loopback) was last loud, so the mic can ignore the
 * interviewer's voice coming back through the speakers.
 */
export function createCallLevel(
  threshold: number,
  now: () => number = Date.now
) {
  let loudAt = -Infinity
  return {
    push(level: number) {
      if (level >= threshold) loudAt = now()
    },
    talking: () => now() - loudAt < ECHO_MS,
  }
}

export function startMicActivity(
  othersTalking: () => boolean = () => false
): MicActivity {
  const detector = createSpeechDetector(Date.now, othersTalking)
  let stopped = false
  let running = false
  let stream: MediaStream | undefined
  let ctx: AudioContext | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const start = async () => {
    const media = navigator.mediaDevices
    if (!media?.getUserMedia || typeof AudioContext === 'undefined') return
    try {
      const device = findMicDevice(
        await media.enumerateDevices(),
        getMicDevice()
      )
      if (!device || stopped) return
      stream = await media.getUserMedia({
        audio: {
          deviceId: { exact: device.deviceId },
          // Keep the interviewer's voice from the speakers out of the mic
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples)
        let sum = 0
        for (const s of samples) sum += s * s
        detector.push(Math.sqrt(sum / samples.length))
      }, FRAME_MS)
      running = true
    } catch {
      // No microphone or no permission: questions are split as before
    }
  }
  void start()

  return {
    spokeAt: () => (running ? detector.spokeAt() : 0),
    on: () => running,
    stop() {
      stopped = true
      running = false
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    },
  }
}

/** A turn with no answer from you still ends after this long. */
export const TURN_MAX_MS = 60_000
/** A skipped clip this long is most likely an answer, which ends the turn. */
export const ANSWER_WORDS = 12

/**
 * Joins the interviewer's passes into one question until you answer. Each
 * sent question either starts a new turn or, if you haven't spoken since the
 * last one (and no long answer was heard), continues it.
 */
export function createTurnTracker(
  mic: Pick<MicActivity, 'spokeAt' | 'on'>,
  enabled: () => boolean,
  now: () => number = Date.now
) {
  let last: { text: string; at: number } | null = null
  return {
    /** The question to send for `text`, and whether it continues the last one. */
    next(text: string): { text: string; continues: boolean } {
      const continues =
        !!last &&
        enabled() &&
        mic.on() &&
        mic.spokeAt() < last.at &&
        now() - last.at <= TURN_MAX_MS
      const joined =
        continues && last && !includesWords(text, last.text)
          ? `${last.text} ${text}`
          : text
      last = { text: joined, at: now() }
      return { text: joined, continues }
    },
    /** A question the judge already joined to the last one. */
    revised(text: string) {
      last = { text, at: now() }
    },
    /** Something that ends the turn (a long answer heard on the call). */
    end() {
      last = null
    },
  }
}

const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)

/** True when most of `inner`'s words are in `text`. */
function includesWords(text: string, inner: string) {
  const have = new Set(words(text))
  const want = words(inner)
  return (
    want.length > 0 &&
    want.filter((w) => have.has(w)).length >= want.length * 0.8
  )
}
