import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { CallSound } from '../CallSound'

// The call's sound on /m/ can stop on its own (a speaker change, the laptop
// waking): it starts again while it should be playing.

const track = () => {
  const t = new EventTarget()
  return Object.assign(t, { kind: 'audio' })
}
const stream = () => {
  const t = track()
  return { getAudioTracks: () => [t] } as unknown as MediaStream
}

describe('CallSound', () => {
  let play: ReturnType<typeof vi.fn>
  let paused = true
  beforeEach(() => {
    vi.useFakeTimers()
    paused = true
    play = vi.fn(() => Promise.resolve())
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(
      () => paused
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('plays again when it stops by itself', () => {
    render(
      <CallSound
        stream={stream()}
        muted={false}
        blocked={false}
        onBlocked={() => {}}
      />
    )
    const first = play.mock.calls.length
    expect(first).toBeGreaterThan(0)
    paused = false
    vi.advanceTimersByTime(4000)
    expect(play.mock.calls.length).toBe(first)
    paused = true
    vi.advanceTimersByTime(2000)
    expect(play.mock.calls.length).toBe(first + 1)
  })

  it('waits for the click while the browser blocks it', () => {
    render(
      <CallSound stream={stream()} muted={false} blocked onBlocked={() => {}} />
    )
    vi.advanceTimersByTime(6000)
    expect(play).not.toHaveBeenCalled()
  })

  it('stops watching once gone', () => {
    const { unmount } = render(
      <CallSound
        stream={stream()}
        muted={false}
        blocked={false}
        onBlocked={() => {}}
      />
    )
    unmount()
    const n = play.mock.calls.length
    vi.advanceTimersByTime(6000)
    expect(play.mock.calls.length).toBe(n)
  })
})
