import { describe, it, expect, vi } from 'vitest'
import {
  wavBytes,
  toggleDictation,
  stopDictation,
  useDictation,
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
})
