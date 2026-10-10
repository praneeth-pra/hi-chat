import { TARGET_SAMPLE_RATE } from './speakerCapture'

/**
 * Live transcription: audio streams to ElevenLabs' realtime model
 * (scribe_v2_realtime), Grok, Soniox or Cartesia while someone talks, so the
 * text is ready moments after the pause instead of after uploading the whole
 * clip. Dictation always streams. For the speaker it is live mode, kept in
 * this browser and off by default.
 */
export const LIVE_MODE_STORAGE_KEY = 'speaker-live-mode'

export function getLiveMode(): boolean {
  try {
    return localStorage.getItem(LIVE_MODE_STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function setLiveMode(on: boolean) {
  try {
    localStorage.setItem(LIVE_MODE_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Storage blocked: live mode stays off
  }
}

export const LIVE_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'

/** How long to wait for the transcript after the pause before giving up. */
export const LIVE_COMMIT_TIMEOUT_MS = 4000

/** Audio is sent in blocks of about 100 ms. */
const SEND_SAMPLES = TARGET_SAMPLE_RATE / 10

/** 16 kHz float samples to base64 little-endian 16-bit PCM. */
export function toPcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

type SocketLike = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((ev: Event) => unknown) | null
  onmessage: ((ev: MessageEvent) => unknown) | null
  onerror: ((ev: Event) => unknown) | null
  onclose: ((ev: CloseEvent) => unknown) | null
}

/** ElevenLabs realtime takes at most 50 key terms of up to 20 characters. */
const ELEVENLABS_MAX_TERMS = 50
const ELEVENLABS_TERM_CHARS = 20

/** The assistant's top key terms (they come most important first) that fit. */
export function elevenLabsTerms(keyterms: string[]): string[] {
  const seen = new Set<string>()
  return keyterms
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter((t) => {
      if (!t || t.length > ELEVENLABS_TERM_CHARS) return false
      if (seen.has(t.toLowerCase())) return false
      seen.add(t.toLowerCase())
      return true
    })
    .slice(0, ELEVENLABS_MAX_TERMS)
}

/**
 * One utterance streamed to ElevenLabs. Audio pushed before the socket opens
 * is held and sent on open. `finish()` commits and resolves with the text.
 */
export class LiveTranscriber {
  private socket: SocketLike | null = null
  private queue: string[] = []
  private pending: Float32Array[] = []
  private pendingLen = 0
  private failed: Error | null = null
  private done: ((text: string) => void) | null = null
  private fail: ((err: Error) => void) | null = null
  private committed = false
  // ElevenLabs commits by itself after ~36 s of audio, even in manual mode;
  // those earlier segments are kept and joined to the final one.
  private earlier: string[] = []

  constructor(
    token: Promise<string>,
    makeSocket: (url: string) => SocketLike = (url) => new WebSocket(url),
    keyterms: string[] = []
  ) {
    token.then(
      (t) => {
        if (this.failed) return
        const params = new URLSearchParams({
          model_id: 'scribe_v2_realtime',
          audio_format: `pcm_${TARGET_SAMPLE_RATE}`,
          commit_strategy: 'manual',
          no_verbatim: 'true',
          // Without it, short replies come back in other languages ("Ja",
          // "Nein", "Ouais" for "Yeah", "Fine", "What")
          language_code: 'en',
          token: t,
        })
        // Key terms cost 20% more, so only dictation sends them
        for (const term of keyterms) params.append('keyterms', term)
        const socket = makeSocket(`${LIVE_URL}?${params}`)
        this.socket = socket
        socket.onopen = () => {
          for (const msg of this.queue.splice(0)) socket.send(msg)
        }
        socket.onmessage = (e) => this.onMessage(e.data)
        socket.onerror = () => this.abort(new Error('Live connection failed'))
        socket.onclose = () =>
          this.abort(new Error('Live connection closed early'))
      },
      (err: Error) => this.abort(err)
    )
  }

  /** Adds 16 kHz audio; sent in ~100 ms blocks. */
  push(samples: Float32Array) {
    this.pending.push(samples)
    this.pendingLen += samples.length
    if (this.pendingLen >= SEND_SAMPLES) this.flush(false)
  }

  /** Sends the rest of the audio with a commit and waits for the text. */
  finish(timeoutMs = LIVE_COMMIT_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.failed) return reject(this.failed)
      // Late: send what ElevenLabs already committed, if anything
      const timer = setTimeout(() => {
        if (this.earlier.length) this.resolveWith('')
        else this.abort(new Error('Live transcript took too long'))
      }, timeoutMs)
      this.done = (text) => {
        clearTimeout(timer)
        resolve(text)
      }
      this.fail = (err) => {
        clearTimeout(timer)
        reject(err)
      }
      this.committed = true
      this.flush(true)
    })
  }

  /** Stops streaming; a pending finish() rejects with `err`. */
  abort(err = new Error('Live transcription stopped')) {
    if (this.failed) return
    this.failed = err
    this.close()
    this.fail?.(err)
  }

  private flush(commit: boolean) {
    const merged = new Float32Array(this.pendingLen)
    let offset = 0
    for (const chunk of this.pending.splice(0)) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    this.pendingLen = 0
    const msg = JSON.stringify({
      message_type: 'input_audio_chunk',
      audio_base_64: toPcm16Base64(merged),
      ...(commit ? { commit: true } : {}),
    })
    if (this.socket?.readyState === 1) this.socket.send(msg)
    else this.queue.push(msg)
  }

  private onMessage(data: unknown) {
    let msg: { message_type?: string; text?: string; error?: string }
    try {
      msg = JSON.parse(String(data))
    } catch {
      return
    }
    if (msg.message_type === 'committed_transcript' && !this.committed) {
      if (msg.text?.trim()) this.earlier.push(msg.text.trim())
    } else if (msg.message_type === 'committed_transcript') {
      this.resolveWith(msg.text ?? '')
    } else if (msg.error) {
      this.abort(new Error(`ElevenLabs live: ${msg.error}`))
    }
  }

  private resolveWith(last: string) {
    const finish = this.done
    this.done = null
    this.fail = null
    this.failed = new Error('Live transcription finished')
    this.close()
    finish?.([...this.earlier, last.trim()].filter(Boolean).join(' '))
  }

  private close() {
    const socket = this.socket
    if (!socket) return
    socket.onclose = null
    socket.onerror = null
    socket.onmessage = null
    try {
      socket.close()
    } catch {
      // Already closed
    }
  }
}

/** 16 kHz float samples to little-endian 16-bit PCM bytes. */
export function toPcm16(samples: Float32Array): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(samples.length * 2))
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return view.buffer
}

/** Grok live goes through our relay, which adds XAI_API_KEY (wsProxy.mjs). */
export const GROK_LIVE_PATH = '/api/grok-live'

/**
 * When `text` starts with the same characters as `prefix` (ignoring spaces),
 * returns what follows, trimmed; otherwise null.
 */
export function afterSameText(text: string, prefix: string): string | null {
  let i = 0
  for (const ch of prefix) {
    if (/\s/.test(ch)) continue
    while (i < text.length && /\s/.test(text[i])) i++
    if (text[i] !== ch) return null
    i++
  }
  return text.slice(i).trim()
}

/**
 * One utterance streamed to Grok Voice Transcribe 2.0 through the relay.
 * Grok sends a final for each stretch of speech it hears end (speech_final
 * restates the whole stretch); `finish()` sends audio.done, which flushes the
 * rest and ends with transcript.done, and resolves with the fullest text.
 */
export class GrokLiveTranscriber {
  private socket: SocketLike | null = null
  private queue: (ArrayBuffer | string)[] = []
  private pending: Float32Array[] = []
  private pendingLen = 0
  private failed: Error | null = null
  private done: ((text: string) => void) | null = null
  private fail: ((err: Error) => void) | null = null
  // Finished stretches, and the locked chunks of the one in progress
  private utterances: string[] = []
  private chunks: string[] = []

  constructor(
    ticket: Promise<string>,
    makeSocket: (url: string) => SocketLike = (url) => new WebSocket(url),
    origin: string = typeof location !== 'undefined'
      ? location.origin
      : 'http://localhost',
    // Words to bias Grok toward; the relay passes them on to xAI
    keyterms: string[] = []
  ) {
    // Browsers can't send the relay token on a WebSocket, so a single-use
    // ticket from the relay stands in for it
    ticket.then(
      (t) => {
        if (this.failed) return
        const params = new URLSearchParams({ ticket: t })
        for (const term of keyterms) params.append('keyterm', term)
        const url = `${origin.replace(/^http/, 'ws')}${GROK_LIVE_PATH}?${params}`
        const socket = makeSocket(url)
        this.socket = socket
        socket.onopen = () => {
          for (const msg of this.queue.splice(0)) socket.send(msg)
        }
        socket.onmessage = (e) => this.onMessage(e.data)
        socket.onerror = () =>
          this.abort(new Error('Grok live connection failed'))
        socket.onclose = () => {
          if (this.done) this.resolveWith('')
          else this.abort(new Error('Grok live connection closed early'))
        }
      },
      (err: Error) => this.abort(err)
    )
  }

  /** Adds 16 kHz audio; sent in ~100 ms blocks. */
  push(samples: Float32Array) {
    this.pending.push(samples)
    this.pendingLen += samples.length
    if (this.pendingLen >= SEND_SAMPLES) this.flush()
  }

  /** Ends the audio and waits for the text. */
  finish(timeoutMs = LIVE_COMMIT_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.failed) return reject(this.failed)
      const timer = setTimeout(() => {
        if (this.heard()) this.resolveWith('')
        else this.abort(new Error('Grok live transcript took too long'))
      }, timeoutMs)
      this.done = (text) => {
        clearTimeout(timer)
        resolve(text)
      }
      this.fail = (err) => {
        clearTimeout(timer)
        reject(err)
      }
      if (this.pendingLen) this.flush()
      this.sendMsg(JSON.stringify({ type: 'audio.done' }))
    })
  }

  /** Stops streaming; a pending finish() rejects with `err`. */
  abort(err = new Error('Grok live transcription stopped')) {
    if (this.failed) return
    this.failed = err
    this.close()
    this.fail?.(err)
  }

  private heard() {
    return [...this.utterances, ...this.chunks].join(' ').trim()
  }

  /** transcript.done may repeat everything or only the end: keep the fuller. */
  private resolveWith(doneText: string) {
    const finish = this.done
    if (!finish) return
    this.done = null
    this.fail = null
    this.failed = new Error('Grok live transcription finished')
    this.close()
    const heard = this.heard()
    const last = doneText.trim()
    if (!last) return finish(heard)
    if (!heard) return finish(last)
    // transcript.done can restate everything with the stretches run together
    // ("…that.And have…"): keep our spaced stretches and take only its end
    const rest = afterSameText(last, heard)
    if (rest !== null) return finish(rest ? `${heard} ${rest}` : heard)
    if (last.length >= heard.length) return finish(last)
    finish(heard.endsWith(last) ? heard : `${heard} ${last}`)
  }

  private flush() {
    const merged = new Float32Array(this.pendingLen)
    let offset = 0
    for (const chunk of this.pending.splice(0)) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    this.pendingLen = 0
    this.sendMsg(toPcm16(merged))
  }

  private sendMsg(msg: ArrayBuffer | string) {
    if (this.socket?.readyState === 1) this.socket.send(msg)
    else this.queue.push(msg)
  }

  private onMessage(data: unknown) {
    let msg: {
      type?: string
      text?: string
      is_final?: boolean
      speech_final?: boolean
      message?: string
    }
    try {
      msg = JSON.parse(String(data))
    } catch {
      return
    }
    const text = msg.text?.trim() ?? ''
    if (msg.type === 'transcript.partial' && msg.is_final && text) {
      if (msg.speech_final) {
        this.utterances.push(text)
        this.chunks = []
      } else this.chunks.push(text)
    } else if (msg.type === 'transcript.done') {
      this.resolveWith(text)
    } else if (msg.type === 'error') {
      this.abort(new Error(`Grok live: ${msg.message ?? 'error'}`))
    }
  }

  private close() {
    const socket = this.socket
    if (!socket) return
    socket.onclose = null
    socket.onerror = null
    socket.onmessage = null
    try {
      socket.close()
    } catch {
      // Already closed
    }
  }
}

export const SONIOX_LIVE_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'
export const SONIOX_LIVE_MODEL = 'stt-rt-v5'
/** Soniox's context holds about 10,000 characters. */
const SONIOX_TERMS_CHARS = 9000

/** Terms without repeats, cut to fit Soniox's context. */
export function sonioxTerms(terms: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  let chars = 0
  for (const raw of terms) {
    const term = raw.replace(/\s+/g, ' ').trim()
    if (!term || seen.has(term.toLowerCase())) continue
    if (chars + term.length + 2 > SONIOX_TERMS_CHARS) break
    seen.add(term.toLowerCase())
    out.push(term)
    chars += term.length + 2
  }
  return out
}

/**
 * One utterance streamed to Soniox (stt-rt-v5) with a temporary key from the
 * relay. The first message is the config, with P's dictionary as context
 * terms; then raw 16-bit PCM. `finish()` sends the empty end-of-audio
 * message, Soniox finalizes every word and says finished, and the final
 * words joined are the text.
 */
export class SonioxLiveTranscriber {
  private socket: SocketLike | null = null
  private queue: (ArrayBuffer | string)[] = []
  private pending: Float32Array[] = []
  private pendingLen = 0
  private failed: Error | null = null
  private done: ((text: string) => void) | null = null
  private fail: ((err: Error) => void) | null = null
  private finals = ''
  private partial = ''

  constructor(
    key: Promise<{ token: string; terms: string[] }>,
    makeSocket: (url: string) => SocketLike = (url) => new WebSocket(url),
    // The assistant's key terms, sent ahead of the dictionary so they're
    // never the ones cut to fit Soniox's context
    keyterms: string[] = []
  ) {
    key.then(
      ({ token, terms }) => {
        if (this.failed) return
        const socket = makeSocket(SONIOX_LIVE_URL)
        this.socket = socket
        socket.onopen = () => {
          // The key goes in the config, as Soniox's own browser SDK does
          socket.send(
            JSON.stringify({
              api_key: token,
              model: SONIOX_LIVE_MODEL,
              audio_format: 'pcm_s16le',
              sample_rate: TARGET_SAMPLE_RATE,
              num_channels: 1,
              language_hints: ['en'],
              context: { terms: sonioxTerms([...keyterms, ...terms]) },
            })
          )
          for (const msg of this.queue.splice(0)) socket.send(msg)
        }
        socket.onmessage = (e) => this.onMessage(e.data)
        socket.onerror = () =>
          this.abort(new Error('Soniox live connection failed'))
        socket.onclose = () => {
          if (this.done) this.resolveWith()
          else this.abort(new Error('Soniox live connection closed early'))
        }
      },
      (err: Error) => this.abort(err)
    )
  }

  /** Adds 16 kHz audio; sent in ~100 ms blocks. */
  push(samples: Float32Array) {
    this.pending.push(samples)
    this.pendingLen += samples.length
    if (this.pendingLen >= SEND_SAMPLES) this.flush()
  }

  /** Ends the audio and waits for the final words. */
  finish(timeoutMs = LIVE_COMMIT_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.failed) return reject(this.failed)
      const timer = setTimeout(() => {
        if (this.heard()) this.resolveWith()
        else this.abort(new Error('Soniox live transcript took too long'))
      }, timeoutMs)
      this.done = (text) => {
        clearTimeout(timer)
        resolve(text)
      }
      this.fail = (err) => {
        clearTimeout(timer)
        reject(err)
      }
      if (this.pendingLen) this.flush()
      // An empty text message ends the audio
      this.sendMsg('')
    })
  }

  /** Stops streaming; a pending finish() rejects with `err`. */
  abort(err = new Error('Soniox live transcription stopped')) {
    if (this.failed) return
    this.failed = err
    this.close()
    this.fail?.(err)
  }

  private heard() {
    return `${this.finals}${this.partial}`.replace(/\s+/g, ' ').trim()
  }

  private resolveWith() {
    const finish = this.done
    if (!finish) return
    this.done = null
    this.fail = null
    this.failed = new Error('Soniox live transcription finished')
    this.close()
    finish(this.heard())
  }

  private flush() {
    const merged = new Float32Array(this.pendingLen)
    let offset = 0
    for (const chunk of this.pending.splice(0)) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    this.pendingLen = 0
    this.sendMsg(toPcm16(merged))
  }

  private sendMsg(msg: ArrayBuffer | string) {
    if (this.socket?.readyState === 1) this.socket.send(msg)
    else this.queue.push(msg)
  }

  private onMessage(data: unknown) {
    let msg: {
      tokens?: { text?: string; is_final?: boolean }[]
      finished?: boolean
      error_code?: number
      error_message?: string
    }
    try {
      msg = JSON.parse(String(data))
    } catch {
      return
    }
    if (msg.error_code) {
      return this.abort(
        new Error(`Soniox live: ${msg.error_message ?? msg.error_code}`)
      )
    }
    // Final words are sent once; the rest are restated in each message
    let partial = ''
    for (const t of msg.tokens ?? []) {
      const text = t.text ?? ''
      if (/^<\w+>$/.test(text)) continue // <end>, <fin> markers
      if (t.is_final) this.finals += text
      else partial += text
    }
    this.partial = partial
    if (msg.finished) this.resolveWith()
  }

  private close() {
    const socket = this.socket
    if (!socket) return
    socket.onclose = null
    socket.onerror = null
    socket.onmessage = null
    try {
      socket.close()
    } catch {
      // Already closed
    }
  }
}

export const CARTESIA_LIVE_URL = 'wss://api.cartesia.ai/stt/websocket'
export const CARTESIA_LIVE_MODEL = 'ink-2'
const CARTESIA_VERSION = '2026-08-14'
/** Cartesia takes up to 100 key terms, 1,200 characters in all. */
const CARTESIA_MAX_TERMS = 100
const CARTESIA_TERMS_CHARS = 1200

/**
 * The key terms Cartesia has room for. The assistant's terms come first;
 * then single words that look technical (capitals or digits, like RBAC,
 * EKS, ec2), since those are what speech engines mishear; then the rest.
 */
export function cartesiaTerms(dictionary: string[], first: string[] = []) {
  const single = dictionary.filter((t) => !/\s/.test(t.trim()))
  const technical = single.filter((t) => /[A-Z0-9]/.test(t.slice(1)))
  const out: string[] = []
  const seen = new Set<string>()
  let chars = 0
  for (const raw of [...first, ...technical, ...single, ...dictionary]) {
    const term = raw.replace(/\s+/g, ' ').trim()
    if (!term || seen.has(term.toLowerCase())) continue
    if (chars + term.length > CARTESIA_TERMS_CHARS) continue
    seen.add(term.toLowerCase())
    out.push(term)
    chars += term.length
    if (out.length === CARTESIA_MAX_TERMS) break
  }
  return out
}

/**
 * One utterance streamed to Cartesia Ink-2 with a short-lived access token
 * from the relay, and up to 100 of P's dictionary terms. Final transcript
 * pieces are joined as they come; `finish()` sends finalize, which flushes
 * the rest and is acknowledged with flush_done.
 */
export class CartesiaLiveTranscriber {
  private socket: SocketLike | null = null
  private queue: (ArrayBuffer | string)[] = []
  private pending: Float32Array[] = []
  private pendingLen = 0
  private failed: Error | null = null
  private done: ((text: string) => void) | null = null
  private fail: ((err: Error) => void) | null = null
  private finals = ''
  private partial = ''

  constructor(
    key: Promise<{ token: string; terms: string[] }>,
    makeSocket: (url: string) => SocketLike = (url) => new WebSocket(url),
    keyterms: string[] = []
  ) {
    key.then(
      ({ token, terms }) => {
        if (this.failed) return
        const params = new URLSearchParams({
          model: CARTESIA_LIVE_MODEL,
          encoding: 'pcm_s16le',
          sample_rate: String(TARGET_SAMPLE_RATE),
          cartesia_version: CARTESIA_VERSION,
          access_token: token,
        })
        for (const term of cartesiaTerms(terms, keyterms))
          params.append('keyterm', term)
        const socket = makeSocket(`${CARTESIA_LIVE_URL}?${params}`)
        this.socket = socket
        socket.onopen = () => {
          for (const msg of this.queue.splice(0)) socket.send(msg)
        }
        socket.onmessage = (e) => this.onMessage(e.data)
        socket.onerror = () =>
          this.abort(new Error('Cartesia live connection failed'))
        socket.onclose = () => {
          if (this.done) this.resolveWith()
          else this.abort(new Error('Cartesia live connection closed early'))
        }
      },
      (err: Error) => this.abort(err)
    )
  }

  /** Adds 16 kHz audio; sent in ~100 ms blocks. */
  push(samples: Float32Array) {
    this.pending.push(samples)
    this.pendingLen += samples.length
    if (this.pendingLen >= SEND_SAMPLES) this.flush()
  }

  /** Flushes the audio and waits for the final text. */
  finish(timeoutMs = LIVE_COMMIT_TIMEOUT_MS): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.failed) return reject(this.failed)
      const timer = setTimeout(() => {
        if (this.heard()) this.resolveWith()
        else this.abort(new Error('Cartesia live transcript took too long'))
      }, timeoutMs)
      this.done = (text) => {
        clearTimeout(timer)
        resolve(text)
      }
      this.fail = (err) => {
        clearTimeout(timer)
        reject(err)
      }
      if (this.pendingLen) this.flush()
      this.sendMsg('finalize')
    })
  }

  /** Stops streaming; a pending finish() rejects with `err`. */
  abort(err = new Error('Cartesia live transcription stopped')) {
    if (this.failed) return
    this.failed = err
    this.close()
    this.fail?.(err)
  }

  private heard() {
    return `${this.finals}${this.partial}`.replace(/\s+/g, ' ').trim()
  }

  private resolveWith() {
    const finish = this.done
    if (!finish) return
    this.done = null
    this.fail = null
    this.failed = new Error('Cartesia live transcription finished')
    this.close()
    finish(this.heard())
  }

  private flush() {
    const merged = new Float32Array(this.pendingLen)
    let offset = 0
    for (const chunk of this.pending.splice(0)) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    this.pendingLen = 0
    this.sendMsg(toPcm16(merged))
  }

  private sendMsg(msg: ArrayBuffer | string) {
    if (this.socket?.readyState === 1) this.socket.send(msg)
    else this.queue.push(msg)
  }

  private onMessage(data: unknown) {
    let msg: {
      type?: string
      text?: string
      is_final?: boolean
      message?: string
    }
    try {
      msg = JSON.parse(String(data))
    } catch {
      return
    }
    if (msg.type === 'transcript') {
      // Final pieces are deltas to join as they are; a partial restates
      // everything since the last final
      if (msg.is_final) {
        this.finals += msg.text ?? ''
        this.partial = ''
      } else this.partial = msg.text ?? ''
    } else if (msg.type === 'flush_done' || msg.type === 'done') {
      if (this.done) this.resolveWith()
    } else if (msg.type === 'error') {
      this.abort(new Error(`Cartesia live: ${msg.message ?? 'error'}`))
    }
  }

  private close() {
    const socket = this.socket
    if (!socket) return
    socket.onclose = null
    socket.onerror = null
    socket.onmessage = null
    try {
      // Ends the session (billed while open)
      if (socket.readyState === 1) socket.send('close')
      socket.close()
    } catch {
      // Already closed
    }
  }
}
