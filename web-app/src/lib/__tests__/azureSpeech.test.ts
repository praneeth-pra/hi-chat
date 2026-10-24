import { describe, it, expect } from 'vitest'
import { AzureLiveTranscriber, azureAuth, azurePhrases } from '../azureSpeech'

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

describe('azurePhrases', () => {
  it('keeps each term once, tidied, up to the limit', () => {
    expect(
      azurePhrases([' EKS ', 'eks', 'NAT  gateway', '', 'Fargate'])
    ).toEqual(['EKS', 'NAT gateway', 'Fargate'])
    expect(azurePhrases(['a', 'b', 'c'], 2)).toEqual(['a', 'b'])
  })
})

/** A stand-in for the Speech SDK: records what the transcriber does. */
function fakeSdk() {
  const written: ArrayBuffer[] = []
  const phrases: string[] = []
  const state: {
    language?: string
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
      fromAuthorizationToken: () => ({
        set speechRecognitionLanguage(v: string) {
          state.language = v
        },
      }),
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
    PhraseListGrammar: {
      fromRecognizer: () => ({ addPhrase: (p: string) => phrases.push(p) }),
    },
    ResultReason: { RecognizedSpeech: 3 },
    CancellationReason: { Error: 1, EndOfStream: 0 },
  }
  return { sdk: async () => sdk as never, written, phrases, state }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('AzureLiveTranscriber', () => {
  it('streams Indian English with the key terms, and joins each stretch at the end', async () => {
    const fake = fakeSdk()
    const previews: string[] = []
    const live = new AzureLiveTranscriber(
      Promise.resolve({ token: 'centralindia:tok', terms: ['Koramangala'] }),
      ['EKS'],
      fake.sdk
    )
    live.setPreviewListener((t) => previews.push(t))
    live.push(new Float32Array(1600)) // before the SDK is ready: held
    await tick()
    expect(fake.state.language).toBe('en-IN')
    expect(fake.phrases).toEqual(['EKS', 'Koramangala'])
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
      Promise.resolve({ token: 'centralindia:tok' }),
      [],
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
