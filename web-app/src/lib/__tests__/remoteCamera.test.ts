import { describe, expect, it, vi } from 'vitest'
import {
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
  lanes: { direction: string }[] = []
  ontrack?: (e: { transceiver: unknown; track: unknown }) => void
  onicecandidate?: () => void
  onconnectionstatechange?: () => void
  closed = false
  constructor() {
    FakePeer.all.push(this)
  }
  addTrack() {}
  addTransceiver(_kind: string, init: { direction: string }) {
    const lane = { direction: init.direction }
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
    const stream = { getTracks: () => [] } as unknown as MediaStream
    globalThis.MediaStream ??= class {
      constructor(public tracks: unknown[]) {}
    } as unknown as typeof MediaStream
    const cam = startCameraSender({
      stream,
      key: 'k',
      location: { protocol: 'https:', host: 'hi.example' },
      onScreen,
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      PeerConnection: FakePeer as unknown as typeof RTCPeerConnection,
    })
    const ws = FakeSocket.last
    ws.hear({ t: 'join', from: 'm1' })
    await flush()
    const pc = FakePeer.all.at(-1)!
    // The offer asks to receive one video lane back
    expect(pc.lanes).toEqual([{ direction: 'recvonly' }])
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
    cam.stop()
  })
})
