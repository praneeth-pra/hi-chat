import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectSpeakerTranscripts } from '../speakerTranscripts'

const result = (name: string, text = 'Which one is cheaper?') => ({
  texts: [text],
  timings: [{ name, ms: 200, ok: true }],
})
afterEach(() => vi.useRealTimers())
describe('speaker transcript readiness', () => {
  it('uses a fast side engine without waiting for a stalled primary or uploading', async () => {
    vi.useFakeTimers()
    const upload = vi.fn()
    const gathered = collectSpeakerTranscripts(
      [new Promise(() => {}), Promise.resolve(result('grok live'))],
      upload
    )
    await vi.advanceTimersByTimeAsync(300)
    expect(await gathered).toEqual(result('grok live'))
    await vi.advanceTimersByTimeAsync(10000)
    expect(upload).not.toHaveBeenCalled()
  })
  it('does not upload when a live result arrives just before the fallback deadline', async () => {
    vi.useFakeTimers()
    let resolve!: (r: ReturnType<typeof result>) => void
    const upload = vi.fn()
    const gathered = collectSpeakerTranscripts(
      [
        new Promise((r) => {
          resolve = r
        }),
        new Promise(() => {}),
      ],
      upload
    )
    await vi.advanceTimersByTimeAsync(1400)
    resolve(result('grok'))
    await vi.advanceTimersByTimeAsync(300)
    expect(await gathered).toEqual(result('grok'))
    expect(upload).not.toHaveBeenCalled()
  })
  it('starts fallback at 1.5 seconds rather than waiting for the live timeout', async () => {
    vi.useFakeTimers()
    const upload = vi.fn(async () => result('batch'))
    const gathered = collectSpeakerTranscripts([new Promise(() => {})], upload)
    await vi.advanceTimersByTimeAsync(1500)
    expect(upload).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(300)
    expect(await gathered).toEqual(result('batch'))
  })
  it('falls back immediately when every live engine fails or returns empty text', async () => {
    const upload = vi.fn(async () => result('batch'))
    expect(
      await collectSpeakerTranscripts(
        [
          Promise.resolve(result('live', '')),
          Promise.reject(new Error('offline')),
        ],
        upload
      )
    ).toEqual(result('batch'))
    expect(upload).toHaveBeenCalledTimes(1)
  })
  it('keeps engine order when results arrive out of order', async () => {
    vi.useFakeTimers()
    let resolve!: (r: ReturnType<typeof result>) => void
    const gathered = collectSpeakerTranscripts(
      [
        new Promise((r) => {
          resolve = r
        }),
        Promise.resolve(result('grok')),
      ],
      vi.fn()
    )
    await vi.advanceTimersByTimeAsync(100)
    resolve(result('elevenlabs'))
    expect((await gathered).timings.map((t) => t.name)).toEqual([
      'elevenlabs',
      'grok',
    ])
  })
  it('propagates batch failure when no live result is usable', async () => {
    await expect(
      collectSpeakerTranscripts([Promise.resolve(null)], async () => {
        throw new Error('signed out')
      })
    ).rejects.toThrow('signed out')
  })
})
