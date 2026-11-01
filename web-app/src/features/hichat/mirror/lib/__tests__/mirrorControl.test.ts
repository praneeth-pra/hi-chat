import { describe, expect, it } from 'vitest'
import { createDirectSender, createDirectViewer } from '../mirrorDirect'

// In-memory stand-ins for RTCPeerConnection and RTCDataChannel: the offer's
// sdp names the sender's connection, and answering it pairs their channels
type Listener = ((e: { data: string }) => void) | null

class FakeChannel {
  readyState = 'connecting'
  bufferedAmount = 0
  other: FakeChannel | null = null
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: Listener = null
  constructor(readonly label: string) {}
  send(data: string) {
    if (this.readyState !== 'open') throw new Error('not open')
    const to = this.other
    queueMicrotask(() => to?.onmessage?.({ data }))
  }
  open() {
    this.readyState = 'open'
    this.onopen?.()
  }
  close() {
    this.readyState = 'closed'
  }
}

const offers = new Map<string, FakePeer>()
let next = 0

class FakePeer {
  connectionState = 'new'
  channels: FakeChannel[] = []
  onicecandidate: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ondatachannel: ((e: { channel: FakeChannel }) => void) | null = null
  createDataChannel(label: string) {
    const c = new FakeChannel(label)
    this.channels.push(c)
    return c
  }
  async createOffer() {
    const sdp = `fake-${next++}`
    offers.set(sdp, this)
    return { type: 'offer', sdp }
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'answer' }
  }
  async setLocalDescription() {}
  async setRemoteDescription(d: { type: string; sdp: string }) {
    if (d.type !== 'offer') return
    const sender = offers.get(d.sdp)
    if (!sender) return
    // The viewer's end of each channel, opened on both sides
    for (const c of sender.channels) {
      const mine = new FakeChannel(c.label)
      mine.other = c
      c.other = mine
      queueMicrotask(() => {
        this.ondatachannel?.({ channel: mine })
        mine.open()
        c.open()
      })
    }
  }
  async addIceCandidate() {}
  close() {
    this.connectionState = 'closed'
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

/** A Hi-chat and one viewer (already let in), joined directly. */
async function pair({
  link,
  canControl = true,
}: {
  link: boolean
  canControl?: boolean
}) {
  const inputs: unknown[] = []
  const control: boolean[] = []
  const toViewer: Record<string, unknown>[] = []
  const sender = createDirectSender({
    signal: (m) => toViewer.push(m),
    canControl,
    onInput: (m) => inputs.push(m),
    PeerConnection: FakePeer as unknown as typeof RTCPeerConnection,
  })
  const viewer = createDirectViewer({
    signal: () => {},
    onMessage: () => {},
    onPong: () => {},
    onChange: () => {},
    onControl: (c) => control.push(c),
    PeerConnection: FakePeer as unknown as typeof RTCPeerConnection,
  })
  sender.receive({ t: 'peer', id: 'v1', on: true, ice: [], link } as never)
  await settle()
  for (const m of toViewer) viewer.receive({ ...m, from: 's1' })
  await settle()
  await settle()
  return { viewer, inputs, control, tick: settle }
}

describe('control over the direct channel', () => {
  it("in the Mac app, a link's viewer (let in with the code) controls at once", async () => {
    const p = await pair({ link: true })
    expect(p.control.at(-1)).toBe(true)
    p.viewer.sendInput({ k: 'kd', c: 1 })
    await p.tick()
    expect(p.inputs).toEqual([{ k: 'kd', c: 1 }])
  })

  it('without the Mac app there is no control', async () => {
    const p = await pair({ link: true, canControl: false })
    expect(p.control.some(Boolean)).toBe(false)
    p.viewer.sendInput({ k: 'kd', c: 1 })
    await p.tick()
    expect(p.inputs).toEqual([])
  })
})
