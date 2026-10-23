import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  wavBytes,
  toggleDictation,
  stopDictation,
  useDictation,
  onBlock,
  getDictationEngine,
  getDictationReduceEcho,
  setDictationReduceEcho,
  setDictationEngine,
  setKeepMicReady,
  startDictation,
  cancelDictation,
  readyMicEarly,
  pickBest,
  gatherAuto,
  getAutoEngines,
  setAutoEngines,
  reportAuto,
  withoutFillers,
  textAgreement,
  retryDictation,
  dismissFailedDictation,
  switchMic,
  type Recording,
} from '../dictation'
import { DICTATION_MIC_STORAGE_KEY, setDictationMic } from '@/lib/micActivity'
import { usePrompt } from '@/hooks/usePrompt'
import { useDictationDelivery } from '../dictationDelivery'

vi.mock('sonner', () => ({ toast: vi.fn() }))
const reportSpeech = vi.hoisted(() => vi.fn())
vi.mock('@/lib/speechServices', async (orig) => ({
  ...(await orig<object>()),
  reportSpeech,
  // The fake live streams below never use their token
  fetchLiveToken: () => new Promise(() => {}),
  fetchLiveKeyWithTerms: () => new Promise(() => {}),
}))
// What every live stream's finish() gives (all four engines share it)
const liveResult = vi.hoisted(() => ({
  finish: (): Promise<string> => Promise.resolve(''),
}))
vi.mock('@/lib/speechLive', async (orig) => {
  class FakeLive {
    push() {}
    abort() {}
    finish() {
      return liveResult.finish()
    }
  }
  return {
    ...(await orig<object>()),
    LiveTranscriber: FakeLive,
    GrokLiveTranscriber: FakeLive,
    SonioxLiveTranscriber: FakeLive,
    CartesiaLiveTranscriber: FakeLive,
  }
})

/** A mic that opens when `open()` is called; `say()` sends it a block. */
function fakeMic() {
  const track = { readyState: 'live', stop: vi.fn() }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  let open!: () => void
  const opened = new Promise<void>((r) => (open = r))
  const getUserMedia = vi.fn(async () => {
    await opened
    return stream
  })
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia, enumerateDevices: async () => [] },
  })
  const nodes: { port: { onmessage: ((e: unknown) => void) | null } }[] = []
  class FakeContext {
    state = 'running'
    sampleRate = 16000
    destination = {}
    audioWorklet = { addModule: async () => {} }
    createMediaStreamSource = () => ({ connect: () => {} })
    resume = async () => {}
    close = async () => {}
  }
  class FakeNode {
    port = { onmessage: null }
    constructor() {
      nodes.push(this)
    }
    connect() {}
    disconnect() {}
  }
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeNode)
  URL.createObjectURL = () => 'blob:x'
  URL.revokeObjectURL = () => {}
  const say = (seconds: number) => {
    for (let i = 0; i < (seconds * 16000) / 2048; i++)
      nodes.at(-1)?.port.onmessage?.({
        data: new Float32Array(2048).fill(0.2),
      })
  }
  return { track, getUserMedia, open, say }
}

/** Records `seconds` of speech with the chosen engine, then stops. */
async function dictate(engine: 'auto' | 'elevenlabs', seconds = 1) {
  setKeepMicReady(false)
  setDictationEngine(engine)
  useDictation.setState({ status: 'idle', failed: undefined })
  const mic = fakeMic()
  mic.open()
  await startDictation()
  mic.say(seconds)
  useDictation.setState({ startedAt: Date.now() - seconds * 1000 })
  await stopDictation()
  return mic
}

/** A relay that answers /api/transcribe with `text`, or fails with `error`. */
function relay(answer: { text?: string; error?: string }) {
  const fetchMock = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify({
          results: [
            answer.error
              ? { ok: false, error: answer.error }
              : { ok: true, text: answer.text },
          ],
        }),
        { status: answer.error ? 502 : 200 }
      )
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('dictation', () => {
  it('encodes 16-bit mono WAV with a correct header', () => {
    const view = new DataView(
      wavBytes(new Float32Array([0, 1, -1, 0.5]), 16000)
    )
    const text = (at: number) =>
      String.fromCharCode(...new Uint8Array(view.buffer, at, 4))
    expect(text(0)).toBe('RIFF')
    expect(text(8)).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(34, true)).toBe(16) // bits
    expect(view.getUint32(40, true)).toBe(8) // 4 samples x 2 bytes
    expect(view.getInt16(46, true)).toBe(0x7fff)
    expect(view.getInt16(48, true)).toBe(-0x8000)
  })

  it('does nothing while the engines are transcribing', () => {
    useDictation.setState({ status: 'transcribing' })
    toggleDictation()
    expect(useDictation.getState().status).toBe('transcribing')
    useDictation.setState({ status: 'idle' })
  })

  it('letting go before the mic opens throws the recording away', async () => {
    useDictation.setState({ status: 'starting' })
    await stopDictation()
    expect(useDictation.getState().status).toBe('idle')
  })

  it('streams every block to ElevenLabs live, at 16 kHz', () => {
    const push = vi.fn()
    const rec = {
      rate: 48000,
      engine: 'elevenlabs',
      live: { push },
      audio: [],
    } as unknown as Recording
    onBlock(rec, new Float32Array(2048).fill(0.2))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][0]).toHaveLength(682) // 48 kHz to 16 kHz
    // ...and keeps the same samples in case the stream fails
    expect(rec.audio).toEqual([push.mock.calls[0][0]])
  })

  it('captures playback through the microphone by default and can opt into suppression', async () => {
    setKeepMicReady(false)
    localStorage.removeItem('dictation-reduce-echo')
    expect(getDictationReduceEcho()).toBe(false)
    const mic = fakeMic()
    mic.open()
    await startDictation()
    expect(mic.getUserMedia).toHaveBeenLastCalledWith({
      audio: { echoCancellation: false, noiseSuppression: false },
    })
    cancelDictation()
    setDictationReduceEcho(true)
    expect(getDictationReduceEcho()).toBe(true)
    await startDictation()
    expect(mic.getUserMedia).toHaveBeenLastCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    cancelDictation()
    localStorage.removeItem('dictation-reduce-echo')
    vi.unstubAllGlobals()
  })
  it('reopens a warm microphone when processing preferences change', async () => {
    setKeepMicReady(false)
    localStorage.removeItem('dictation-reduce-echo')
    const mic = fakeMic()
    mic.open()
    setKeepMicReady(true)
    await startDictation()
    cancelDictation()
    // A preference changed in another tab must not reuse the old processed stream.
    localStorage.setItem('dictation-reduce-echo', 'on')
    await startDictation()
    expect(mic.getUserMedia).toHaveBeenCalledTimes(2)
    expect(mic.getUserMedia).toHaveBeenLastCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    cancelDictation()
    setKeepMicReady(false)
    localStorage.removeItem('dictation-reduce-echo')
    vi.unstubAllGlobals()
  })
  it('remembers the chosen engine, Auto by default', () => {
    localStorage.removeItem('dictation-engine')
    expect(getDictationEngine()).toBe('auto')
    setDictationEngine('elevenlabs')
    expect(getDictationEngine()).toBe('elevenlabs')
    localStorage.removeItem('dictation-engine')
  })

  it('keeps the mic open so the next dictation starts instantly', async () => {
    const track = { readyState: 'live', stop: vi.fn() }
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
    const getUserMedia = vi.fn(async () => stream)
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia, enumerateDevices: async () => [] },
    })
    class FakeContext {
      state = 'running'
      sampleRate = 48000
      destination = {}
      audioWorklet = { addModule: async () => {} }
      createMediaStreamSource = () => ({ connect: () => {} })
      resume = async () => {}
      close = async () => {}
    }
    class FakeNode {
      port = { onmessage: null }
      connect() {}
      disconnect() {}
    }
    vi.stubGlobal('AudioContext', FakeContext)
    vi.stubGlobal('AudioWorkletNode', FakeNode)
    URL.createObjectURL = () => 'blob:x'
    URL.revokeObjectURL = () => {}
    setKeepMicReady(true)
    useDictation.setState({ status: 'idle' })

    await startDictation()
    expect(useDictation.getState().status).toBe('recording')
    cancelDictation()
    expect(track.stop).not.toHaveBeenCalled()

    void startDictation()
    // No await: the mic is already open
    expect(useDictation.getState().status).toBe('recording')
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    cancelDictation()

    setKeepMicReady(false)
    expect(track.stop).toHaveBeenCalled()
    localStorage.removeItem('dictation-keep-mic')
    vi.unstubAllGlobals()
  })

  it('opens an allowed mic when Jan loads and finishes on the first key press', async () => {
    const track = { readyState: 'live', stop: vi.fn() }
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
    const getUserMedia = vi.fn(async () => stream)
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia, enumerateDevices: async () => [] },
      permissions: { query: async () => ({ state: 'granted' }) },
    })
    const contexts: unknown[] = []
    class FakeContext {
      state = 'running'
      sampleRate = 48000
      destination = {}
      audioWorklet = { addModule: async () => {} }
      createMediaStreamSource = () => ({ connect: () => {} })
      resume = async () => {}
      close = async () => {}
      constructor() {
        contexts.push(this)
      }
    }
    class FakeNode {
      port = { onmessage: null }
      connect() {}
      disconnect() {}
    }
    vi.stubGlobal('AudioContext', FakeContext)
    vi.stubGlobal('AudioWorkletNode', FakeNode)
    URL.createObjectURL = () => 'blob:x'
    URL.revokeObjectURL = () => {}
    setKeepMicReady(true)
    useDictation.setState({ status: 'idle' })
    const settle = () => new Promise((r) => setTimeout(r, 0))

    readyMicEarly()
    await settle()
    // The mic is open, but no audio starts before a click or key press
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(contexts).toHaveLength(0)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    await settle()
    expect(contexts).toHaveLength(1)

    void startDictation()
    // No await: ready before the first dictation
    expect(useDictation.getState().status).toBe('recording')
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    cancelDictation()

    setKeepMicReady(false)
    expect(track.stop).toHaveBeenCalled()
    localStorage.removeItem('dictation-keep-mic')
    vi.unstubAllGlobals()
  })

  it('Auto picks the text the other engines agree with most', () => {
    expect(textAgreement('What is EKS?', 'what is eks')).toBe(1)
    expect(textAgreement('a b c d', 'a x c d')).toBe(0.75)
    expect(
      pickBest([
        { engine: 'cartesia', text: 'What is cube cuddle?' },
        { engine: 'grok', text: 'What is kubectl?' },
        { engine: 'elevenlabs', text: 'What is kubectl.' },
      ])?.engine
    ).toBe('grok')
    // One misheard word is outvoted by the other two (18 Oct)
    expect(
      pickBest([
        {
          engine: 'cartesia',
          text: 'Uh, coming to uh AWS RDS, so how would you ensure that uh multi region availability? So how would you configure in such a way that it survives a one reason downtime?',
        },
        {
          engine: 'soniox',
          text: 'Uh, coming to, uh, AWS RDS—so how would you ensure that a multi-region availability—so how would you configure in such a way that it survives a one-region downtime?',
        },
        {
          engine: 'elevenlabs',
          text: 'Coming to AWS RDS, so how would you ensure that multi-region availability? So how would you configure in such a way that it survives one region downtime?',
        },
      ])?.text
    ).toContain('region downtime')
    // Two answers (or a tie): the first
    expect(
      pickBest([
        { engine: 'cartesia', text: 'one' },
        { engine: 'grok', text: 'two' },
      ])?.engine
    ).toBe('cartesia')
    expect(
      pickBest([
        { engine: 'cartesia', text: '' },
        { engine: 'grok', text: 'two' },
      ])?.text
    ).toBe('two')
  })

  it('Auto streams every block to each live engine', () => {
    const grok = { push: vi.fn() }
    const eleven = { push: vi.fn() }
    const rec = {
      rate: 16000,
      engine: 'auto',
      autoLive: [
        { engine: 'grok', stream: grok },
        { engine: 'elevenlabs', stream: eleven },
      ],
      audio: [],
    } as unknown as Recording
    const loud = new Float32Array(2048).fill(0.2)
    for (let i = 0; i < 35; i++) onBlock(rec, loud)
    for (let i = 0; i < 5; i++) onBlock(rec, new Float32Array(2048))
    expect(grok.push).toHaveBeenCalledTimes(40)
    expect(eleven.push).toHaveBeenCalledTimes(40)
  })

  it('Auto gives the slower engines a short grace once one has answered', async () => {
    vi.useFakeTimers()
    try {
      const results = gatherAuto([
        { engine: 'cartesia', text: new Promise(() => {}) },
        { engine: 'grok', text: Promise.resolve('fast') },
        { engine: 'elevenlabs', text: Promise.reject(new Error('down')) },
      ])
      await vi.advanceTimersByTimeAsync(1000)
      await expect(results).resolves.toEqual([{ engine: 'grok', text: 'fast' }])
      // Two engines that agree: sent at once, without waiting for Cartesia
      const quorum = gatherAuto([
        { engine: 'cartesia', text: new Promise(() => {}) },
        { engine: 'soniox', text: Promise.resolve('What is an S3 bucket?') },
        { engine: 'elevenlabs', text: Promise.resolve('what is an S3 bucket') },
      ])
      await vi.advanceTimersByTimeAsync(0)
      await expect(quorum).resolves.toEqual([
        { engine: 'soniox', text: 'What is an S3 bucket?' },
        { engine: 'elevenlabs', text: 'what is an S3 bucket' },
      ])
      // Two that differ on a word: the third still gets a short grace
      let eleven!: (t: string) => void
      const close = gatherAuto([
        {
          engine: 'cartesia',
          text: Promise.resolve(
            'So how would you configure the database in such a way that it survives a one reason downtime'
          ),
        },
        {
          engine: 'soniox',
          text: Promise.resolve(
            'So how would you configure the database in such a way that it survives a one region downtime'
          ),
        },
        { engine: 'elevenlabs', text: new Promise((r) => (eleven = r)) },
      ])
      await vi.advanceTimersByTimeAsync(100)
      eleven(
        'So how would you configure the database in such a way that it survives a one region downtime'
      )
      await expect(close).resolves.toHaveLength(3)
      await expect(
        gatherAuto([
          { engine: 'cartesia', text: Promise.reject(new Error('no key')) },
        ])
      ).rejects.toThrow('cartesia: no key')
    } finally {
      vi.useRealTimers()
    }
  })

  it('Auto waits less once an engine has come back empty', async () => {
    vi.useFakeTimers()
    try {
      let soniox!: (t: string) => void
      const results = gatherAuto([
        { engine: 'cartesia', text: Promise.resolve('') },
        { engine: 'soniox', text: new Promise((r) => (soniox = r)) },
        { engine: 'elevenlabs', text: Promise.resolve('What is EKS?') },
      ])
      await vi.advanceTimersByTimeAsync(499)
      soniox('What is EKS?')
      // Soniox still in time: it agrees and is kept
      await expect(results).resolves.toHaveLength(3)
      const late = gatherAuto([
        { engine: 'cartesia', text: Promise.resolve('') },
        { engine: 'soniox', text: new Promise(() => {}) },
        { engine: 'elevenlabs', text: Promise.resolve('What is EKS?') },
      ])
      await vi.advanceTimersByTimeAsync(500)
      await expect(late).resolves.toEqual([
        { engine: 'cartesia', text: '' },
        { engine: 'elevenlabs', text: 'What is EKS?' },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('Auto stops waiting at the deadline, or sends the first text after it', async () => {
    vi.useFakeTimers()
    try {
      let soniox!: (t: string) => void
      const results = gatherAuto(
        [
          { engine: 'cartesia', text: Promise.resolve('What is an S3 bucket') },
          { engine: 'soniox', text: new Promise((r) => (soniox = r)) },
          {
            engine: 'elevenlabs',
            text: Promise.resolve('What is an extra bucket'),
          },
        ],
        950
      )
      await vi.advanceTimersByTimeAsync(949)
      soniox('What is an S3 bucket')
      // In time: Soniox's vote is kept
      await expect(results).resolves.toHaveLength(3)
      const cut = gatherAuto(
        [
          { engine: 'cartesia', text: Promise.resolve('What is an S3 bucket') },
          { engine: 'soniox', text: new Promise(() => {}) },
          {
            engine: 'elevenlabs',
            text: Promise.resolve('What is an extra bucket'),
          },
        ],
        950
      )
      await vi.advanceTimersByTimeAsync(950)
      await expect(cut).resolves.toHaveLength(2)
      // Nothing heard by the deadline: the first text goes as it arrives
      let cartesia!: (t: string) => void
      const slow = gatherAuto(
        [
          { engine: 'cartesia', text: new Promise((r) => (cartesia = r)) },
          { engine: 'soniox', text: new Promise(() => {}) },
          { engine: 'elevenlabs', text: new Promise(() => {}) },
        ],
        950
      )
      await vi.advanceTimersByTimeAsync(1200)
      cartesia('What is EKS?')
      await expect(slow).resolves.toEqual([
        { engine: 'cartesia', text: 'What is EKS?' },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('Auto races the engines chosen in Settings, in tie-break order', () => {
    expect(getAutoEngines()).toEqual(['cartesia', 'soniox', 'elevenlabs'])
    setAutoEngines(['grok', 'cartesia'])
    expect(getAutoEngines()).toEqual(['cartesia', 'grok'])
    // None chosen falls back to the default three
    setAutoEngines([])
    expect(getAutoEngines()).toEqual(['cartesia', 'soniox', 'elevenlabs'])
    localStorage.removeItem('dictation-auto-engines')
  })

  it('logs the engines that lost the race once they answer', async () => {
    let lateGrok!: (t: string) => void
    const done = reportAuto(
      [
        { engine: 'grok', text: new Promise((r) => (lateGrok = r)) },
        { engine: 'soniox', text: Promise.resolve('What is EKS?') },
        { engine: 'cartesia', text: Promise.resolve('What is EKS?') },
        { engine: 'elevenlabs', text: Promise.reject(new Error('down')) },
      ],
      { soniox: 300, cartesia: 120 },
      { sent: 'soniox', totalMs: 310 }
    )
    lateGrok('What is EKS? ')
    await done
    const line = reportSpeech.mock.calls.at(-1)?.[0] as string
    expect(line).toContain('sent=soniox total=310ms')
    expect(line).toContain('grok: "What is EKS?"')
    expect(line).toContain('elevenlabs: failed (down)')
  })

  it('Auto ignores filler words: they agree, and the text sent has none', () => {
    expect(
      textAgreement(
        'like check alerts and like uh filter them, um, based on that',
        'Check alerts and filter them based on that.'
      )
    ).toBe(1)
    expect(
      withoutFillers('... uh so we, um, use Terraform. Hmm, and Umbrella')
    ).toBe('So we use Terraform. And Umbrella')
    expect(withoutFillers('Uh, my career started in TCS')).toBe(
      'My career started in TCS'
    )
  })
  it('cancel then start again while the mic opens records once, on an open mic', async () => {
    setKeepMicReady(false)
    useDictation.setState({ status: 'idle' })
    const mic = fakeMic()
    const first = startDictation()
    cancelDictation()
    const second = startDictation()
    expect(useDictation.getState().status).toBe('starting')
    mic.open()
    await Promise.all([first, second])
    // The first start gave up: it neither recorded nor closed the mic
    // under the second one
    expect(useDictation.getState().status).toBe('recording')
    expect(mic.getUserMedia).toHaveBeenCalledTimes(1)
    expect(mic.track.stop).not.toHaveBeenCalled()
    cancelDictation()
    expect(mic.track.stop).toHaveBeenCalled()
    localStorage.removeItem('dictation-keep-mic')
    vi.unstubAllGlobals()
  })

  it('a start cancelled while the mic opens closes it once it opens', async () => {
    setKeepMicReady(false)
    useDictation.setState({ status: 'idle' })
    const mic = fakeMic()
    const start = startDictation()
    cancelDictation()
    mic.open()
    await start
    expect(useDictation.getState().status).toBe('idle')
    expect(mic.track.stop).toHaveBeenCalled()
    localStorage.removeItem('dictation-keep-mic')
    vi.unstubAllGlobals()
  })

  it('a newly chosen mic replaces the open one', async () => {
    const tracks: { readyState: string; stop: ReturnType<typeof vi.fn> }[] = []
    const getUserMedia = vi.fn(async (_c: MediaStreamConstraints) => {
      const track = { readyState: 'live', stop: vi.fn() }
      tracks.push(track)
      return { getTracks: () => [track], getAudioTracks: () => [track] }
    })
    const devices = [
      {
        kind: 'audioinput',
        label: 'MacBook Mic',
        deviceId: 'mac',
        groupId: 'g1',
      },
      { kind: 'audioinput', label: 'USB Mic', deviceId: 'usb', groupId: 'g2' },
    ]
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia, enumerateDevices: async () => devices },
    })
    class FakeContext {
      state = 'running'
      sampleRate = 48000
      destination = {}
      audioWorklet = { addModule: async () => {} }
      createMediaStreamSource = () => ({ connect: () => {} })
      resume = async () => {}
      close = async () => {}
    }
    class FakeNode {
      port = { onmessage: null }
      connect() {}
      disconnect() {}
    }
    vi.stubGlobal('AudioContext', FakeContext)
    vi.stubGlobal('AudioWorkletNode', FakeNode)
    URL.createObjectURL = () => 'blob:x'
    URL.revokeObjectURL = () => {}
    const deviceOf = (call: number) =>
      (
        (getUserMedia.mock.calls[call][0].audio as MediaTrackConstraints)
          .deviceId as { exact: string }
      ).exact
    setDictationMic('MacBook Mic')
    setKeepMicReady(true)
    useDictation.setState({ status: 'idle' })

    await startDictation()
    cancelDictation()
    expect(deviceOf(0)).toBe('mac')

    // Chosen in Settings: the open mic moves at once
    setDictationMic('USB Mic')
    switchMic()
    await new Promise((r) => setTimeout(r, 0))
    expect(tracks[0].stop).toHaveBeenCalled()
    expect(deviceOf(1)).toBe('usb')

    // Changed elsewhere (another tab): the next dictation reopens
    setDictationMic('MacBook Mic')
    await startDictation()
    expect(useDictation.getState().status).toBe('recording')
    expect(tracks[1].stop).toHaveBeenCalled()
    expect(deviceOf(2)).toBe('mac')
    cancelDictation()

    setKeepMicReady(false)
    localStorage.removeItem('dictation-keep-mic')
    localStorage.removeItem(DICTATION_MIC_STORAGE_KEY)
    vi.unstubAllGlobals()
  })

  describe('when the live engines lose a dictation', () => {
    beforeEach(() => {
      usePrompt.getState().resetPrompt()
      useDictationDelivery.setState({ pending: [] })
    })
    afterEach(() => {
      liveResult.finish = () => Promise.resolve('')
      dismissFailedDictation()
      usePrompt.getState().resetPrompt()
      useDictationDelivery.setState({ pending: [] })
      localStorage.removeItem('dictation-engine')
      localStorage.removeItem('dictation-keep-mic')
      vi.unstubAllGlobals()
    })

    it('sends live text without touching the batch route', async () => {
      liveResult.finish = () => Promise.resolve('What is EKS?')
      const fetchMock = relay({ text: 'unused' })
      await dictate('elevenlabs')
      expect(usePrompt.getState().prompt).toBe('What is EKS?')
      expect(useDictationDelivery.getState().pending).toEqual(['What is EKS?'])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('Auto: every stream failing sends the recording to the batch route', async () => {
      liveResult.finish = () => Promise.reject(new Error('no token'))
      const fetchMock = relay({ text: 'What is a NAT gateway?' })
      await dictate('auto', 2)
      expect(usePrompt.getState().prompt).toBe('What is a NAT gateway?')
      expect(useDictationDelivery.getState().pending).toEqual([
        'What is a NAT gateway?',
      ])
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/transcribe')
      const body = init.body as FormData
      expect(body.get('need')).toBe('1')
      // Every block (16 of 2048 samples), 16-bit, plus the 44-byte header
      expect((body.get('file') as Blob).size).toBe(44 + 16 * 2048 * 2)
      expect(useDictation.getState()).toMatchObject({
        status: 'idle',
        failed: undefined,
      })
    })

    it('requests usable speech in the batch race and ignores empty results before a valid transcript', async () => {
      liveResult.finish = () => Promise.resolve('')
      const fetchMock = vi.fn(
        async (_url: string, _init: RequestInit) =>
          new Response(
            JSON.stringify({
              results: [
                { ok: true, text: '   ' },
                { ok: true, text: 'Explain ECS pricing.' },
              ],
            })
          )
      )
      vi.stubGlobal('fetch', fetchMock)
      await dictate('auto')
      expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData)
      const body = fetchMock.mock.calls[0][1].body as FormData
      expect(body.get('require_text')).toBe('1')
      expect(usePrompt.getState().prompt).toBe('Explain ECS pricing.')
    })
    it('a live engine that heard nothing also falls back', async () => {
      const fetchMock = relay({ text: 'Run kubectl get pods.' })
      await dictate('elevenlabs')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(usePrompt.getState().prompt).toBe('Run kubectl get pods.')
      expect(useDictationDelivery.getState().pending).toEqual([
        'Run kubectl get pods.',
      ])
    })

    it('keeps the audio when the batch route fails too, and Retry resends it', async () => {
      liveResult.finish = () => Promise.reject(new Error('offline'))
      relay({ error: 'ElevenLabs failed (500)' })
      await dictate('elevenlabs')
      expect(useDictation.getState()).toMatchObject({
        status: 'idle',
        failed: 'offline; ElevenLabs failed (500)',
      })

      const fetchMock = relay({ text: 'What is EKS?' })
      await retryDictation()
      expect(usePrompt.getState().prompt).toBe('What is EKS?')
      expect(useDictationDelivery.getState().pending).toEqual(['What is EKS?'])
      expect(
        (fetchMock.mock.calls[0][1].body as FormData).get('file')
      ).toBeTruthy()
      expect(useDictation.getState().failed).toBeUndefined()
      // Nothing left to retry
      await retryDictation()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })
})

describe('auto-stop on silence', () => {
  it('stops only after 2 minutes without sound, and only when on', async () => {
    const { silentTooLong, SILENCE_STOP_MS } = await import('../dictation')
    const rec = { lastSound: 1_000 }
    expect(silentTooLong(rec, 1_000 + SILENCE_STOP_MS - 1, true)).toBe(false)
    expect(silentTooLong(rec, 1_000 + SILENCE_STOP_MS, true)).toBe(true)
    expect(silentTooLong(rec, 1_000 + SILENCE_STOP_MS, false)).toBe(false)
    expect(silentTooLong({}, 10 * SILENCE_STOP_MS, true)).toBe(false)
  })

  it('counts a voice as sound and a quiet room as silence', async () => {
    const { onBlock } = await import('../dictation')
    vi.useFakeTimers()
    const rec = {
      rate: 16000,
      engine: 'elevenlabs',
      audio: [],
    } as unknown as Recording
    onBlock(rec, new Float32Array(2048))
    const first = rec.lastSound!
    vi.setSystemTime(first + 5000)
    onBlock(rec, new Float32Array(2048).fill(0.001)) // quiet room
    expect(rec.lastSound).toBe(first)
    onBlock(rec, new Float32Array(2048).fill(0.1)) // speaking
    expect(rec.lastSound).toBe(first + 5000)
    vi.useRealTimers()
  })
})
