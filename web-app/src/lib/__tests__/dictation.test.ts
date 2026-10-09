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
  type Recording,
} from '../dictation'

vi.mock('sonner', () => ({ toast: vi.fn() }))

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

  it('does nothing while Aqua is transcribing', () => {
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

  it('sends a piece to Aqua at a pause once 4 s are held', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ text: 'first part.' }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const rec = {
      rate: 16000,
      chunks: [],
      quietMs: 0,
      pieces: [],
    } as unknown as Recording
    const loud = new Float32Array(2048).fill(0.2)
    const quiet = new Float32Array(2048)
    for (let i = 0; i < 20; i++) onBlock(rec, loud) // 2.6 s
    for (let i = 0; i < 5; i++) onBlock(rec, quiet) // a pause, but too soon
    expect(rec.pieces).toHaveLength(0)
    for (let i = 0; i < 15; i++) onBlock(rec, loud) // now past 4 s
    for (let i = 0; i < 5; i++) onBlock(rec, quiet)
    expect(rec.pieces).toHaveLength(1)
    expect(rec.chunks).toHaveLength(0)
    expect(await rec.pieces[0]).toBe('first part.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('sends Grok pieces to the transcribe route and reads its result', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({ results: [{ ok: true, text: 'grok text' }] }),
          { status: 200 }
        )
    )
    vi.stubGlobal('fetch', fetchMock)
    const rec = {
      rate: 16000,
      engine: 'grok',
      chunks: [],
      quietMs: 0,
      pieces: [],
    } as unknown as Recording
    const loud = new Float32Array(2048).fill(0.2)
    for (let i = 0; i < 35; i++) onBlock(rec, loud)
    for (let i = 0; i < 5; i++) onBlock(rec, new Float32Array(2048))
    expect(await rec.pieces[0]).toBe('grok text')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/transcribe')
    expect((init.body as FormData).get('engines')).toBe('grok')
    vi.unstubAllGlobals()
  })

  it('streams every block to ElevenLabs live instead of making pieces', () => {
    const push = vi.fn()
    const rec = {
      rate: 48000,
      engine: 'elevenlabs',
      live: { push },
      chunks: [],
      quietMs: 0,
      pieces: [],
    } as unknown as Recording
    onBlock(rec, new Float32Array(2048).fill(0.2))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][0]).toHaveLength(682) // 48 kHz to 16 kHz
    expect(rec.chunks).toHaveLength(0)
  })

  it('remembers the chosen engine, Aqua by default', () => {
    localStorage.removeItem('dictation-engine')
    expect(getDictationEngine()).toBe('aqua')
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
})
