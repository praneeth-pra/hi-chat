import { describe, it, expect } from 'vitest'
import {
  AZURE_MODEL,
  AzureLiveTranscriber,
  azureAuth,
  azureEndpoint,
} from '../azureSpeech'

describe('azureAuth', () => {
  it("splits the relay's region and token", () => {
    expect(azureAuth('centralindia:eyJ.abc')).toEqual({
      region: 'centralindia',
      token: 'eyJ.abc',
    })
    expect(() => azureAuth('nonsense')).toThrow('Azure token missing')
    expect(() => azureAuth('Bad Region:x')).toThrow('Azure token missing')
  })
})

/** A stand-in for the Speech SDK: records what the transcriber does. */
function fakeSdk() {
  const written: ArrayBuffer[] = []
  const state: {
    language?: string
    endpoint?: string
    token?: string
    model?: string
    closed: boolean
    recognizer?: {
      recognizing?: (r: unknown, e: { result: { text: string } }) => void
      recognized?: (
        r: unknown,
        e: { result: { text: string; reason: number } }
      ) => void
      canceled?: (
        r: unknown,
        e: { reason: number; errorDetails?: string }
      ) => void
      sessionStopped?: () => void
    }
    started: boolean
  } = { closed: false, started: false }
  const sdk = {
    AudioStreamFormat: { getWaveFormatPCM: () => ({}) },
    AudioInputStream: {
      createPushStream: () => ({
        write: (d: ArrayBuffer) => written.push(d),
        close: () => {
          state.closed = true
        },
      }),
    },
    AudioConfig: { fromStreamInput: () => ({}) },
    SpeechConfig: {
      fromEndpoint: (url: URL) => {
        state.endpoint = url.toString()
        return {
          set speechRecognitionLanguage(v: string) {
            state.language = v
          },
          set authorizationToken(v: string) {
            state.token = v
          },
          setModel: (name: string) => {
            state.model = name
          },
        }
      },
    },
    SpeechRecognizer: class {
      constructor() {
        state.recognizer = this as never
      }
      startContinuousRecognitionAsync() {
        state.started = true
      }
      stopContinuousRecognitionAsync(ok: () => void) {
        ok()
      }
      close() {}
    },
    ResultReason: { RecognizedSpeech: 3 },
    CancellationReason: { Error: 1, EndOfStream: 0 },
  }
  return { sdk: async () => sdk as never, written, state }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('AzureLiveTranscriber', () => {
  it('streams to MAI-Transcribe-2 with the token, and joins each stretch at the end', async () => {
    const fake = fakeSdk()
    const previews: string[] = []
    const live = new AzureLiveTranscriber(
      Promise.resolve({ token: 'southeastasia:tok' }),
      fake.sdk
    )
    live.setPreviewListener((t) => previews.push(t))
    live.push(new Float32Array(1600)) // before the SDK is ready: held
    await tick()
    expect(fake.state.endpoint).toBe(
      'wss://southeastasia.stt.speech.microsoft.com/speech/universal/v2'
    )
    expect(fake.state.endpoint).toBe(azureEndpoint('southeastasia'))
    expect(fake.state.model).toBe(AZURE_MODEL)
    expect(fake.state.model).toBe('MAI-Transcribe-2-Streaming')
    expect(fake.state.token).toBe('tok')
    expect(fake.state.language).toBe('en-US')
    expect(fake.state.started).toBe(true)
    expect(fake.written[0].byteLength).toBe(3200)
    const r = fake.state.recognizer!
    r.recognizing?.(null, { result: { text: 'I stay in' } })
    r.recognized?.(null, {
      result: { text: 'I stay in Koramangala.', reason: 3 },
    })
    const text = live.finish()
    // End of audio closes the input; Azure writes out the rest, then stops
    expect(fake.state.closed).toBe(true)
    r.recognized?.(null, { result: { text: 'What is EKS?', reason: 3 } })
    r.sessionStopped?.()
    await expect(text).resolves.toBe('I stay in Koramangala. What is EKS?')
    expect(previews).toEqual([
      'I stay in',
      'I stay in Koramangala.',
      'I stay in Koramangala. What is EKS?',
    ])
  })

  it('fails with Azure’s reason when it reports an error', async () => {
    const fake = fakeSdk()
    const live = new AzureLiveTranscriber(
      Promise.resolve({ token: 'southeastasia:tok' }),
      fake.sdk
    )
    await tick()
    const text = live.finish()
    fake.state.recognizer!.canceled?.(null, {
      reason: 1,
      errorDetails: 'Unauthorized',
    })
    await expect(text).rejects.toThrow('Azure live: Unauthorized')
  })
})
