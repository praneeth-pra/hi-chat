import { describe, it, expect, vi } from 'vitest'
import {
  wavBytes,
  toggleDictation,
  stopDictation,
  useDictation,
  onBlock,
  getDictationEngine,
  setDictationEngine,
  setKeepMicReady,
  startDictation,
  cancelDictation,
  readyMicEarly,
  pickBest,
  gatherAuto,
  reportAuto,
  withoutFillers,
  textAgreement,
  type Recording,
} from '../dictation'

vi.mock('sonner', () => ({ toast: vi.fn() }))
const reportClip = vi.hoisted(() => vi.fn())
vi.mock('@/lib/speakerCaptureSession', async (orig) => ({
  ...(await orig<object>()),
  reportClip,
}))

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
    } as unknown as Recording
    onBlock(rec, new Float32Array(2048).fill(0.2))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][0]).toHaveLength(682) // 48 kHz to 16 kHz
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
      await expect(
        gatherAuto([
          { engine: 'cartesia', text: Promise.reject(new Error('no key')) },
        ])
      ).rejects.toThrow('cartesia: no key')
    } finally {
      vi.useRealTimers()
    }
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
    const line = reportClip.mock.calls.at(-1)?.[0] as string
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
})
