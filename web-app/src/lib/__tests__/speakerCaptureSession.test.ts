import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  grokLive,
  reportClip,
  setTranscribeMode,
  getTranscribeMode,
  grokFirst,
  sonioxCartesiaLive,
  startSpeakerCapture,
  transcribeClip,
} from '../speakerCaptureSession'

const flush = () => new Promise((r) => setTimeout(r, 0))

function track() {
  return { stop: vi.fn(), addEventListener: vi.fn() }
}

describe('startSpeakerCapture', () => {
  let deviceChange: (() => void) | undefined
  let getUserMedia: ReturnType<typeof vi.fn>
  let contexts: number

  beforeEach(() => {
    contexts = 0
    let labelled = false
    getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
      const t = track()
      if (c.audio === true) {
        labelled = true
        // Safari fires devicechange when the permission probe opens.
        deviceChange?.()
      }
      return { getTracks: () => [t], getAudioTracks: () => [t] }
    })
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia,
        enumerateDevices: vi.fn(async () =>
          labelled
            ? [{ kind: 'audioinput', label: 'BlackHole 2ch', deviceId: 'bh' }]
            : [{ kind: 'audioinput', label: '', deviceId: 'x' }]
        ),
        addEventListener: (_: string, fn: () => void) => (deviceChange = fn),
        removeEventListener: vi.fn(),
      },
    })
    vi.stubGlobal(
      'AudioWorkletNode',
      class {
        port: { onmessage: unknown } = { onmessage: null }
        connect() {}
      }
    )
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running'
        sampleRate = 48000
        destination = {}
        audioWorklet = { addModule: async () => {} }
        constructor() {
          contexts++
        }
        createMediaStreamSource() {
          return { connect() {} }
        }
        resume = async () => {}
        close = async () => {}
      }
    )
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens only one BlackHole capture even if devices change while starting', async () => {
    const statuses: string[] = []
    const session = startSpeakerCapture({
      onStatus: (s) => statuses.push(s),
      onText: () => {},
    })
    for (let i = 0; i < 10; i++) await flush()
    deviceChange?.()
    for (let i = 0; i < 10; i++) await flush()

    const loopbackOpens = getUserMedia.mock.calls.filter(
      ([c]) => c.audio !== true
    )
    expect(loopbackOpens).toHaveLength(1)
    expect(contexts).toBe(1)
    expect(statuses.at(-1)).toBe('listening')
    session.stop()
  })
})

describe('transcribeClip', () => {
  const audio = new Blob([new Uint8Array(10)], { type: 'audio/flac' })
  const reply = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {}
  ) => new Response(JSON.stringify(body), { status, headers })
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem('speaker-relay-token', 'tok')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('uploads once with the token and returns every transcript in order', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        results: [
          { name: 'elevenlabs', ok: true, ms: 700, text: 'eleven text' },
          { name: 'grok', ok: true, ms: 650, text: 'grok text' },
        ],
      })
    )
    setTranscribeMode('live')
    const out = await transcribeClip(audio)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/transcribe')
    expect(init.headers['X-Relay-Token']).toBe('tok')
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob)
    // Grok live without live mode uploads to Grok instead
    expect((init.body as FormData).get('engines')).toBe('elevenlabs,grok')
    expect((init.body as FormData).get('need')).toBeNull()
    expect((init.body as FormData).get('wait_ms')).toBe('1000')
    expect(out.texts).toEqual(['eleven text', 'grok text'])
    expect(out.timings).toEqual([
      { name: 'elevenlabs', ms: 700, ok: true },
      { name: 'grok', ms: 650, ok: true },
    ])
    localStorage.removeItem('speaker-transcribe-mode')
    // Soniox + Cartesia (the default) only stream; uploads go to ElevenLabs
    fetchMock.mockResolvedValue(
      reply(200, {
        results: [{ name: 'elevenlabs', ok: true, ms: 700, text: 'x' }],
      })
    )
    await transcribeClip(audio)
    expect((fetchMock.mock.calls[1][1].body as FormData).get('engines')).toBe(
      'elevenlabs'
    )
  })

  it('uses whichever engine answered and leaves out engines with no key', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        results: [
          { name: 'grok', ok: false, ms: 300, error: 'down' },
          { name: 'elevenlabs', ok: false, ms: 0, off: true },
        ],
      })
    )
    await expect(transcribeClip(audio)).rejects.toThrow('down')

    fetchMock.mockResolvedValue(
      reply(200, {
        results: [
          { name: 'grok', ok: true, ms: 800, text: 'hi' },
          { name: 'elevenlabs', ok: false, ms: 0, off: true },
        ],
      })
    )
    const out = await transcribeClip(audio)
    expect(out.texts).toEqual(['hi'])
    expect(out.timings).toEqual([{ name: 'grok', ms: 800, ok: true }])
  })

  it('forgets a rejected token so it is asked for again', async () => {
    fetchMock.mockResolvedValue(reply(401, {}, { 'X-Relay-Rejected': '1' }))
    await expect(transcribeClip(audio)).rejects.toThrow('Relay token')
    expect(localStorage.getItem('speaker-relay-token')).toBeNull()
  })
})

describe('transcribe mode', () => {
  afterEach(() => {
    localStorage.removeItem('speaker-transcribe-mode')
    vi.unstubAllGlobals()
  })

  it('asks the relay for ElevenLabs only when that is chosen', async () => {
    localStorage.setItem('speaker-relay-token', 'tok')
    setTranscribeMode('elevenlabs')
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { name: 'elevenlabs', ok: true, ms: 600, text: 'hi there' },
          ],
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)
    const out = await transcribeClip(new Blob([new Uint8Array(4)]))
    const form = fetchMock.mock.calls[0][1].body as FormData
    expect(form.get('engines')).toBe('elevenlabs')
    expect(form.get('wait_ms')).toBeNull()
    expect(out.texts).toEqual(['hi there'])
  })

  it('streams Soniox and Cartesia by default; Grok when picked', () => {
    localStorage.setItem('speaker-live-mode', 'on')
    expect([sonioxCartesiaLive(), grokLive()]).toEqual([true, false])
    setTranscribeMode('live')
    expect(grokLive()).toBe(true)
    localStorage.setItem('speaker-live-mode', 'off')
    expect(grokLive()).toBe(false)
  })

  it('forgets the removed Aqua choice and falls back to the default', () => {
    localStorage.setItem('speaker-transcribe-mode', 'both')
    expect(getTranscribeMode()).toBe('live-soniox-cartesia')
  })
})

describe('reportClip', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('posts the clip line with the relay token', () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem('speaker-relay-token', 'tok')
    reportClip('sent "What is a pod?"')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string; headers: Record<string, string> },
    ]
    expect(url).toBe('/api/speaker-log')
    expect(init.headers['X-Relay-Token']).toBe('tok')
    expect(JSON.parse(init.body)).toEqual({ line: 'sent "What is a pod?"' })
  })

  it('stays quiet without a token instead of asking for one', () => {
    const fetchMock = vi.fn()
    const prompt = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('prompt', prompt)
    reportClip('skipped "Hi"')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
  })
})

describe('grokFirst', () => {
  const names = ['elevenlabs live', 'grok live']
  it('puts Grok first when it heard the whole clip', () => {
    expect(
      grokFirst(
        [
          'How you integrate Gemstone with Jenkins?',
          'How you integrate JMeter with Jenkins?',
        ],
        names
      )
    ).toEqual([
      'How you integrate JMeter with Jenkins?',
      'How you integrate Gemstone with Jenkins?',
    ])
  })
  it('keeps ElevenLabs first when Grok lost words or heard nothing', () => {
    const el = 'Are you doing some A/B testing today?'
    expect(grokFirst([el, 'You are doing some...'], names)[0]).toBe(el)
    expect(grokFirst([el, ''], names)[0]).toBe(el)
    expect(grokFirst([el], ['elevenlabs live'])).toEqual([el])
  })
  it('puts Cartesia first when it heard the clip', () => {
    const texts = ['What is Pinoops?', 'What is FinOps?', 'What is FinOps.']
    expect(
      grokFirst(texts, ['elevenlabs live', 'soniox live', 'cartesia live'])[0]
    ).toBe('What is FinOps.')
    expect(
      grokFirst(
        ['What is Pinoops?', 'What is FinOps?', ''],
        ['elevenlabs live', 'soniox live', 'cartesia live']
      )[0]
    ).toBe('What is Pinoops?')
  })
})
