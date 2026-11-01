import { describe, expect, it, vi } from 'vitest'
import {
  createSlowWatch,
  readScreenStats,
  screenStatsBetween,
  cameraSocketUrl,
  crc32,
  extensionConfig,
  startCameraSender,
  zipFiles,
} from '../remoteCamera'

class FakeSocket {
  static OPEN = 1
  static last: FakeSocket
  readyState = 1
  sent: Record<string, unknown>[] = []
  onopen?: () => void
  onmessage?: (e: { data: string }) => void
  onclose?: () => void
  constructor() {
    FakeSocket.last = this
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {}
  hear(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) })
  }
}

class FakePeer {
  static all: FakePeer[] = []
  connectionState = 'new'
  lanes: { kind: string; direction: string }[] = []
  ontrack?: (e: { transceiver: unknown; track: unknown }) => void
  onicecandidate?: () => void
  onconnectionstatechange?: () => void
  closed = false
  constructor() {
    FakePeer.all.push(this)
  }
  addTrack() {}
  addTransceiver(kind: string, init: { direction: string }) {
    const lane = { kind, direction: init.direction }
    this.lanes.push(lane)
    return lane
  }
  getSenders() {
    return []
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0' }
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  close() {
    this.closed = true
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('remote camera', () => {
  it('builds the socket address with the key', () => {
    expect(
      cameraSocketUrl({ protocol: 'https:', host: 'hi.example' }, 'a b')
    ).toBe('wss://hi.example/api/camera?role=send&key=a%20b')
  })

  it('computes standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('packs files into a valid stored zip', () => {
    const zip = zipFiles({ 'a/x.txt': 'hello', 'a/y.js': 'é' })
    const view = new DataView(zip.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    // End of central directory: two entries
    const end = zip.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    const text = new TextDecoder().decode(zip)
    expect(text).toContain('a/x.txthello')
  })

  it('writes the extension config as a script', () => {
    const config = extensionConfig('https://hi.example', 'k1')
    expect(config).toContain(
      'self.HICHAT_CAMERA = {"site":"https://hi.example","key":"k1"}'
    )
  })

  it('shows the screen a Meet tab presents, and drops it when it stops', async () => {
    const onScreen = vi.fn()
    const onCall = vi.fn()
    const stream = { getTracks: () => [] } as unknown as MediaStream
    globalThis.MediaStream ??= class {
      constructor(public tracks: unknown[]) {}
    } as unknown as typeof MediaStream
    const cam = startCameraSender({
      stream,
      key: 'k',
      location: { protocol: 'https:', host: 'hi.example' },
      onScreen,
      onCall,
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      PeerConnection: FakePeer as unknown as typeof RTCPeerConnection,
    })
    const ws = FakeSocket.last
    ws.hear({ t: 'join', from: 'm1' })
    await flush()
    const pc = FakePeer.all.at(-1)!
    // The offer asks for two lanes back: the presented screen, the call's sound
    expect(pc.lanes).toEqual([
      { kind: 'video', direction: 'recvonly' },
      { kind: 'audio', direction: 'recvonly' },
    ])
    // The call's sound plays as soon as it arrives, presenting or not
    pc.ontrack?.({ transceiver: pc.lanes[1], track: { kind: 'audio' } })
    expect(onCall.mock.lastCall?.[0]).not.toBeNull()
    pc.ontrack?.({ transceiver: pc.lanes[0], track: { kind: 'video' } })
    // Connected but not presenting: nothing to show yet
    expect(onScreen).not.toHaveBeenCalled()

    ws.hear({ t: 'screen', on: true, from: 'm1' })
    await flush()
    expect(onScreen).toHaveBeenLastCalledWith(expect.anything())
    expect(onScreen.mock.lastCall?.[0]).not.toBeNull()

    ws.hear({ t: 'screen', on: false, from: 'm1' })
    await flush()
    expect(onScreen).toHaveBeenLastCalledWith(null)

    // Presenting again, then the Meet tab goes away
    ws.hear({ t: 'screen', on: true, from: 'm1' })
    await flush()
    expect(onScreen.mock.lastCall?.[0]).not.toBeNull()
    ws.hear({ t: 'leave', from: 'm1' })
    await flush()
    expect(onScreen).toHaveBeenLastCalledWith(null)
    expect(onCall).toHaveBeenLastCalledWith(null)
    cam.stop()
  })

  it('keeps a live camera connection through a blip in the server connection', async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream
    const cam = startCameraSender({
      stream,
      key: 'k',
      location: { protocol: 'https:', host: 'hi.example' },
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      PeerConnection: FakePeer as unknown as typeof RTCPeerConnection,
    })
    const first = FakeSocket.last
    first.hear({ t: 'join', from: 'tab-1' })
    first.hear({ t: 'join', from: 'tab-2' })
    await flush()
    const [up, pending] = FakePeer.all.slice(-2)
    up.connectionState = 'connected'

    vi.useFakeTimers()
    first.onclose?.()
    // The connected one carries on; the one still being set up goes
    expect(up.closed).toBe(false)
    expect(pending.closed).toBe(true)
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()
    const second = FakeSocket.last
    expect(second).not.toBe(first)

    // The same tab rejoins: no new offer, the media never stopped
    const peers = FakePeer.all.length
    second.hear({ t: 'join', from: 'tab-1' })
    await flush()
    expect(FakePeer.all.length).toBe(peers)
    expect(second.sent.some((m) => m.t === 'offer')).toBe(false)

    // Its connection fails (a network change): offered again, once
    up.connectionState = 'failed'
    up.onconnectionstatechange?.()
    await flush()
    expect(up.closed).toBe(true)
    expect(FakePeer.all.length).toBe(peers + 1)
    expect(second.sent.filter((m) => m.t === 'offer')).toHaveLength(1)
    const again = FakePeer.all.at(-1)!
    again.connectionState = 'failed'
    again.onconnectionstatechange?.()
    await flush()
    expect(FakePeer.all.length).toBe(peers + 1)
    cam.stop()
  })

  it('reads how quickly the shared screen arrives', () => {
    const report = new Map<string, Record<string, unknown>>([
      [
        'in',
        {
          type: 'inbound-rtp',
          kind: 'video',
          framesDecoded: 300,
          jitterBufferDelay: 3,
          jitterBufferEmittedCount: 300,
          totalDecodeTime: 1.5,
        },
      ],
      [
        'pair',
        {
          type: 'candidate-pair',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.04,
          localCandidateId: 'l',
          remoteCandidateId: 'r',
        },
      ],
      ['l', { type: 'local-candidate', candidateType: 'srflx' }],
      ['r', { type: 'remote-candidate', candidateType: 'host' }],
    ])
    const read = readScreenStats(report as unknown as RTCStatsReport)!
    expect(read.rttMs).toBe(40)
    expect(read.relay).toBe(false)
    // Two seconds later: 60 more frames, each 5 ms in the buffer, 4 ms decoding
    const later = {
      framesDecoded: 360,
      jitterBufferDelay: 3.3,
      jitterBufferEmittedCount: 360,
      totalDecodeTime: 1.74,
    }
    const s = screenStatsBetween(
      { s: read.counters, at: 0 },
      { s: later, at: 2000 },
      read.rttMs,
      read.relay
    )
    expect(s.fps).toBe(30)
    expect(s.bufferMs).toBe(5)
    expect(s.decodeMs).toBe(4)
    // 20 (half the round trip) + 17 (half a frame) + 5 + 4
    expect(s.estimateMs).toBe(46)
    // Through a relay, it says so
    report.set('l', { type: 'local-candidate', candidateType: 'relay' })
    expect(readScreenStats(report as unknown as RTCStatsReport)!.relay).toBe(
      true
    )
  })

  it('lightens the picture only after 3 slow readings in a row', () => {
    const watch = createSlowWatch()
    const at = (decodeMs: number, bufferMs = 20, fps = 30) => ({
      fps,
      rttMs: 20,
      bufferMs,
      decodeMs,
      relay: false,
      estimateMs: 60,
    })
    expect(watch(at(35))).toBe(false)
    expect(watch(at(35))).toBe(false)
    // A good reading starts the count again
    expect(watch(at(5))).toBe(false)
    expect(watch(at(35))).toBe(false)
    // A still screen (no frames) says nothing either way
    expect(watch(at(0, 0, 0))).toBe(false)
    expect(watch(null)).toBe(false)
    expect(watch(at(35))).toBe(false)
    // Frames waiting long count as slow too
    expect(watch(at(5, 300))).toBe(true)
  })

  it('asks every Meet tab for a lighter screen, and new presenters too', async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream
    const cam = startCameraSender({
      stream,
      key: 'k',
      location: { protocol: 'https:', host: 'hi.example' },
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      PeerConnection: FakePeer as unknown as typeof RTCPeerConnection,
    })
    const ws = FakeSocket.last
    ws.hear({ t: 'join', from: 'tab-1' })
    await flush()
    cam.setLightScreen(true)
    expect(ws.sent.at(-1)).toEqual({ t: 'light', to: 'tab-1', on: true })
    // Asking twice sends nothing more
    const n = ws.sent.length
    cam.setLightScreen(true)
    expect(ws.sent.length).toBe(n)
    // A tab that starts presenting later hears it as well
    ws.hear({ t: 'join', from: 'tab-2' })
    await flush()
    ws.hear({ t: 'screen', on: true, from: 'tab-2' })
    await flush()
    expect(ws.sent).toContainEqual({ t: 'light', to: 'tab-2', on: true })
    cam.stop()
  })
})
