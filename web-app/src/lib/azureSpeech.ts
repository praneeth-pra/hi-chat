import { toPcm16 } from './speechLive'

/**
 * One clip streamed to Azure Speech (Indian English, en-IN) with Microsoft's
 * Speech SDK, loaded only when this engine runs. The relay turns
 * AZURE_SPEECH_KEY into a token valid 10 minutes ("region:token"), so the key
 * never reaches the browser. Azure writes out each stretch of speech as it
 * hears it end; `finish()` ends the audio, Azure writes out the rest, and
 * the stretches are joined. Key terms go in as a phrase list.
 */
type Sdk = typeof import('microsoft-cognitiveservices-speech-sdk')

const loadSdk = (): Promise<Sdk> =>
  import('microsoft-cognitiveservices-speech-sdk')

/** Splits the relay's "region:token". */
export function azureAuth(value: string): { region: string; token: string } {
  const at = value.indexOf(':')
  const region = at > 0 ? value.slice(0, at) : ''
  const token = at > 0 ? value.slice(at + 1) : ''
  if (!/^[a-z0-9]{2,40}$/.test(region) || !token)
    throw new Error('Azure token missing')
  return { region, token }
}

/** Azure's phrase list: the key terms, without repeats. */
export function azurePhrases(keyterms: string[], max = 500): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of keyterms) {
    const term = raw.replace(/\s+/g, ' ').trim()
    if (!term || seen.has(term.toLowerCase())) continue
    seen.add(term.toLowerCase())
    out.push(term)
    if (out.length === max) break
  }
  return out
}

type Recognizer = {
  startContinuousRecognitionAsync(
    ok?: () => void,
    err?: (e: string) => void
  ): void
  stopContinuousRecognitionAsync(
    ok?: () => void,
    err?: (e: string) => void
  ): void
  close(): void
}
type Push = { write(data: ArrayBuffer): void; close(): void }

export class AzureLiveTranscriber {
  private onPreview?: (text: string) => void
  private input: Push | null = null
  private recognizer: Recognizer | null = null
  private queue: ArrayBuffer[] = []
  private failed: Error | null = null
  private done: ((text: string) => void) | null = null
  private fail: ((err: Error) => void) | null = null
  private parts: string[] = []
  private hearing = ''
  private ended = false

  setPreviewListener(listener: (text: string) => void) {
    this.onPreview = listener
  }

  constructor(
    // The relay's "region:token", and P's dictionary terms
    auth: Promise<{ token: string; terms?: string[] }>,
    keyterms: string[] = [],
    sdk: () => Promise<Sdk> = loadSdk
  ) {
    Promise.all([auth, sdk()]).then(
      ([value, s]) => {
        if (this.failed) return
        try {
          this.start(s, azureAuth(value.token), [
            ...keyterms,
            ...(value.terms ?? []),
          ])
        } catch (err) {
          this.abort(err as Error)
        }
      },
      (err: Error) => this.abort(err)
    )
  }

  private start(
    s: Sdk,
    { region, token }: { region: string; token: string },
    keyterms: string[]
  ) {
    const format = s.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1)
    const push = s.AudioInputStream.createPushStream(format)
    const config = s.SpeechConfig.fromAuthorizationToken(token, region)
    config.speechRecognitionLanguage = 'en-IN'
    const recognizer = new s.SpeechRecognizer(
      config,
      s.AudioConfig.fromStreamInput(push)
    )
    const phrases = azurePhrases(keyterms)
    if (phrases.length) {
      const list = s.PhraseListGrammar.fromRecognizer(recognizer)
      for (const p of phrases) list.addPhrase(p)
    }
    recognizer.recognizing = (_r, e) => {
      this.hearing = e.result.text ?? ''
      this.onPreview?.(this.text(true))
    }
    recognizer.recognized = (_r, e) => {
      if (e.result.reason === s.ResultReason.RecognizedSpeech) {
        const text = e.result.text?.trim()
        if (text) this.parts.push(text)
      }
      this.hearing = ''
      this.onPreview?.(this.text())
    }
    recognizer.canceled = (_r, e) => {
      if (e.reason === s.CancellationReason.Error)
        this.abort(new Error(`Azure live: ${e.errorDetails || 'error'}`))
      else this.end()
    }
    recognizer.sessionStopped = () => this.end()
    this.input = push as unknown as Push
    this.recognizer = recognizer as unknown as Recognizer
    for (const chunk of this.queue.splice(0)) this.input.write(chunk)
    if (this.ended) this.input.close()
    recognizer.startContinuousRecognitionAsync(undefined, (e) =>
      this.abort(new Error(`Azure live: ${e}`))
    )
  }

  /** Adds 16 kHz audio. */
  push(samples: Float32Array) {
    if (this.ended || this.failed) return
    const pcm = toPcm16(samples)
    if (this.input) this.input.write(pcm)
    else this.queue.push(pcm)
  }

  /** Ends the audio and waits for the final text. */
  finish(timeoutMs = 4000): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.failed) return reject(this.failed)
      const timer = setTimeout(() => {
        const text = this.text(true)
        if (text) this.resolveWith(text)
        else this.abort(new Error('Azure live transcript took too long'))
      }, timeoutMs)
      this.done = (text) => {
        clearTimeout(timer)
        resolve(text)
      }
      this.fail = (err) => {
        clearTimeout(timer)
        reject(err)
      }
      this.ended = true
      // End of audio: Azure writes out what it has heard, then stops
      this.input?.close()
    })
  }

  /** Stops streaming; a pending finish() rejects with `err`. */
  abort(err = new Error('Azure live transcription stopped')) {
    if (this.failed) return
    this.failed = err
    this.close()
    this.fail?.(err)
  }

  private text(withHearing = false) {
    return [
      ...this.parts,
      ...(withHearing && this.hearing ? [this.hearing] : []),
    ]
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private end() {
    if (this.done) this.resolveWith(this.text(true))
  }

  private resolveWith(text: string) {
    const finish = this.done
    if (!finish) return
    this.done = null
    this.fail = null
    this.failed = new Error('Azure live transcription finished')
    this.close()
    finish(text.trim())
  }

  private close() {
    const recognizer = this.recognizer
    this.recognizer = null
    try {
      this.input?.close()
    } catch {
      // Already closed
    }
    if (!recognizer) return
    try {
      recognizer.stopContinuousRecognitionAsync(
        () => recognizer.close(),
        () => recognizer.close()
      )
    } catch {
      // Already closed
    }
  }
}
