import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  MIRROR_CLOSE_LINK_ENDED,
  MIRROR_CLOSE_VERSION_UNSUPPORTED,
} from '@janhq/core'

// The mirror viewer's transport: each update applied once whichever route
// (the server's socket or the direct channel) brings it, and the socket
// opened again after it drops, backing off, except on a link that has ended.

type Viewer = {
  onMessage: (m: Record<string, unknown>) => void
  onChange: (open: number) => void
}
const direct = vi.hoisted(() => ({ viewer: null as Viewer | null }))

vi.mock('@/lib/mirrorDirect', async (actual) => ({
  ...(await actual<typeof import('@/lib/mirrorDirect')>()),
  // The real sequence filter, a stand-in for the WebRTC channel
  createDirectViewer: (opts: Viewer) => {
    direct.viewer = opts
    return {
      receive: () => {},
      ping: () => {},
      sendInput: () => false,
      closeAll: () => {},
    }
  },
}))

import { useMirrorTransport } from '../useMirrorTransport'

class FakeSocket {
  static OPEN = 1
  static all: FakeSocket[] = []
  readyState = 0
  sent: Record<string, unknown>[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {}
}
const last = () => FakeSocket.all.at(-1)!
const open = () =>
  act(() => {
    last().readyState = 1
    last().onopen?.()
  })
const hear = (m: unknown) =>
  act(() => last().onmessage?.({ data: JSON.stringify(m) }))
const drop = (code = 1006) => act(() => last().onclose?.({ code }))
const viaDirect = (m: Record<string, unknown>) =>
  act(() => direct.viewer!.onMessage(m))

/** An update from Hi-chat `s`, number `q`, adding one message. */
const update = (q: number, s = 'app') => ({
  t: 'ops',
  s,
  q,
  add: [{ id: `m${q}`, role: 'user', text: `message ${q}` }],
})

beforeEach(() => {
  FakeSocket.all = []
  direct.viewer = null
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useMirrorTransport: each update once', () => {
  it('applies an update that comes both ways once', async () => {
    const { result } = renderHook(() => useMirrorTransport())
    open()
    viaDirect(update(0))
    hear(update(0))
    hear(update(1))
    viaDirect(update(1))
    await waitFor(() => expect(result.current.state.msgs).toHaveLength(2))
    // Nothing more lands later
    await new Promise((r) => setTimeout(r, 50))
    expect(result.current.state.msgs.map((m) => m.id)).toEqual(['m0', 'm1'])
  })

  it('holds a direct update that came early until the one before it', async () => {
    const { result } = renderHook(() => useMirrorTransport())
    open()
    hear(update(0))
    viaDirect(update(2))
    await waitFor(() => expect(result.current.state.msgs).toHaveLength(1))
    viaDirect(update(1))
    await waitFor(() =>
      expect(result.current.state.msgs.map((m) => m.id)).toEqual([
        'm0',
        'm1',
        'm2',
      ])
    )
    // The server's copies, arriving after, change nothing
    hear(update(1))
    hear(update(2))
    await new Promise((r) => setTimeout(r, 50))
    expect(result.current.state.msgs).toHaveLength(3)
  })

  it('keeps each sender in step separately', async () => {
    const { result } = renderHook(() => useMirrorTransport())
    open()
    hear(update(5, 'a'))
    hear(update(5, 'b'))
    await waitFor(() => expect(result.current.state.msgs).toHaveLength(2))
  })
})

describe('useMirrorTransport: reconnecting', () => {
  it('opens the socket again, backing off from 1 s, and resets once open', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useMirrorTransport())
    open()
    expect(result.current.connected).toBe(true)
    drop()
    expect(result.current.connected).toBe(false)
    expect(FakeSocket.all).toHaveLength(1)
    act(() => vi.advanceTimersByTime(999))
    expect(FakeSocket.all).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(FakeSocket.all).toHaveLength(2)
    // Fails before opening: twice as long next time
    drop()
    act(() => vi.advanceTimersByTime(1999))
    expect(FakeSocket.all).toHaveLength(2)
    act(() => vi.advanceTimersByTime(1))
    expect(FakeSocket.all).toHaveLength(3)
    // Open again: back to 1 s
    open()
    drop()
    act(() => vi.advanceTimersByTime(1000))
    expect(FakeSocket.all).toHaveLength(4)
  })

  it('backs off to at most 15 s', () => {
    vi.useFakeTimers()
    renderHook(() => useMirrorTransport())
    for (const wait of [1000, 2000, 4000, 8000, 15_000, 15_000]) {
      const before = FakeSocket.all.length
      drop()
      act(() => vi.advanceTimersByTime(wait - 1))
      expect(FakeSocket.all).toHaveLength(before)
      act(() => vi.advanceTimersByTime(1))
      expect(FakeSocket.all).toHaveLength(before + 1)
    }
  })

  it('waits 15 s for a server that is older than this page', () => {
    vi.useFakeTimers()
    renderHook(() => useMirrorTransport())
    open()
    drop(MIRROR_CLOSE_VERSION_UNSUPPORTED)
    act(() => vi.advanceTimersByTime(14_999))
    expect(FakeSocket.all).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('stops, and clears the conversation, when the link has ended', async () => {
    const { result } = renderHook(() =>
      useMirrorTransport('abcdefghijklmnopqrstuv')
    )
    open()
    hear(update(0))
    await waitFor(() => expect(result.current.state.msgs).toHaveLength(1))
    vi.useFakeTimers()
    drop(MIRROR_CLOSE_LINK_ENDED)
    expect(result.current.ended).toBe(true)
    expect(result.current.state.msgs).toHaveLength(0)
    act(() => vi.advanceTimersByTime(60_000))
    expect(FakeSocket.all).toHaveLength(1)
  })

  it('connects again at once when the network comes back', () => {
    vi.useFakeTimers()
    renderHook(() => useMirrorTransport())
    open()
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(FakeSocket.all).toHaveLength(2)
    // The old socket closing late doesn't start another
    act(() => FakeSocket.all[0].onclose?.({ code: 1006 }))
    act(() => vi.advanceTimersByTime(30_000))
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('comes back in on a link with the ticket it was let in with', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useMirrorTransport('abcdefghijklmnopqrstuv')
    )
    open()
    hear({ t: 'gate' })
    expect(result.current.gate.shut).toBe(true)
    hear({ t: 'admitted', ticket: 'T'.repeat(24) })
    expect(result.current.gate.shut).toBe(false)
    expect(result.current.ticket).toBe('T'.repeat(24))
    expect(FakeSocket.all[0].url).not.toContain('ticket=')
    drop()
    act(() => vi.advanceTimersByTime(1000))
    expect(last().url).toContain(`ticket=${'T'.repeat(24)}`)
  })

  it('stops trying once unmounted', () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useMirrorTransport())
    open()
    drop()
    unmount()
    act(() => vi.advanceTimersByTime(60_000))
    expect(FakeSocket.all).toHaveLength(1)
  })
})
