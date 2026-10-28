import { describe, expect, it } from 'vitest'
import {
  CODE_TRIES,
  CODE_TTL_MS,
  createDirectSender,
  createDirectViewer,
  type UnlockState,
} from '../mirrorDirect'

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

/** A Mac app's Hi-chat and one viewer, joined directly. */
async function pair({
  link,
  canControl = true,
}: {
  link: boolean
  canControl?: boolean
}) {
  let time = 0
  const codes: (string | null)[] = []
  const inputs: unknown[] = []
  const control: boolean[] = []
  const unlock: UnlockState[] = []
  const toViewer: Record<string, unknown>[] = []
  const sender = createDirectSender({
    signal: (m) => toViewer.push(m),
    canControl,
    onInput: (m) => inputs.push(m),
    onCode: (c) => codes.push(c),
    makeCode: () => '4821',
    now: () => time,
    PeerConnection: FakePeer as unknown as typeof RTCPeerConnection,
  })
  const viewer = createDirectViewer({
    signal: () => {},
    onMessage: () => {},
    onPong: () => {},
    onChange: () => {},
    onControl: (c) => control.push(c),
    onUnlock: (u) => unlock.push(u),
    PeerConnection: FakePeer as unknown as typeof RTCPeerConnection,
  })
  sender.receive({ t: 'peer', id: 'v1', on: true, ice: [], link } as never)
  await settle()
  for (const m of toViewer) viewer.receive({ ...m, from: 's1' })
  await settle()
  await settle()
  return {
    sender,
    viewer,
    codes,
    inputs,
    control,
    unlock,
    advance: (ms: number) => (time += ms),
    tick: async () => {
      await settle()
      await settle()
    },
  }
}

describe('unlocking control from a mirror link', () => {
  it('a signed-in viewer controls at once and never needs a code', async () => {
    const p = await pair({ link: false })
    expect(p.control.at(-1)).toBe(true)
    expect(p.unlock.some((u) => u.can)).toBe(false)
  })

  it("a link's viewer is locked until it types the code Hi-chat shows", async () => {
    const p = await pair({ link: true })
    expect(p.control.at(-1)).not.toBe(true)
    expect(p.unlock.at(-1)).toEqual({ can: true })
    // Nothing gets through before the code
    p.viewer.sendInput({ k: 'kd', c: 1 })
    await p.tick()
    expect(p.inputs).toEqual([])

    expect(p.viewer.askForCode()).toBe(true)
    await p.tick()
    expect(p.codes).toEqual(['4821'])

    p.viewer.sendCode('4821')
    await p.tick()
    expect(p.control.at(-1)).toBe(true)
    expect(p.unlock.at(-1)).toEqual({ can: false })
    expect(p.codes.at(-1)).toBe(null) // the code is hidden again
    p.viewer.sendInput({ k: 'kd', c: 1 })
    await p.tick()
    expect(p.inputs).toEqual([{ k: 'kd', c: 1 }])
  })

  it('a code typed before asking for one does nothing', async () => {
    const p = await pair({ link: true })
    p.viewer.sendCode('4821')
    await p.tick()
    expect(p.control.at(-1)).not.toBe(true)
    expect(p.unlock.at(-1)?.left).toBe(0)
  })

  it(`counts down wrong codes, and after ${CODE_TRIES} the code is gone`, async () => {
    const p = await pair({ link: true })
    p.viewer.askForCode()
    await p.tick()
    for (let i = 1; i <= CODE_TRIES; i++) {
      p.viewer.sendCode('0000')
      await p.tick()
      expect(p.unlock.at(-1)?.left).toBe(CODE_TRIES - i)
    }
    expect(p.codes.at(-1)).toBe(null)
    // The right code is too late now
    p.viewer.sendCode('4821')
    await p.tick()
    expect(p.control.at(-1)).not.toBe(true)
  })

  it('gives one code per connection, and a new connection a new one', async () => {
    const p = await pair({ link: true })
    p.viewer.askForCode()
    await p.tick()
    // Asking again while it is good: the same code, not a new one
    p.viewer.askForCode()
    await p.tick()
    expect(p.codes).toEqual(['4821', '4821'])
    for (let i = 0; i < CODE_TRIES; i++) {
      p.viewer.sendCode('0000')
      await p.tick()
    }
    expect(p.codes.at(-1)).toBe(null)
    // Used up: no second code on this connection
    p.viewer.askForCode()
    await p.tick()
    expect(p.codes.filter(Boolean)).toEqual(['4821', '4821'])
    expect(p.unlock.at(-1)).toMatchObject({ left: 0, spent: true })

    // A new connection (a reload) gets a fresh code
    const q = await pair({ link: true })
    q.viewer.askForCode()
    await q.tick()
    expect(q.codes).toEqual(['4821'])
  })

  it('a code runs out after its time', async () => {
    const p = await pair({ link: true })
    p.viewer.askForCode()
    await p.tick()
    p.advance(CODE_TTL_MS + 1)
    p.viewer.sendCode('4821')
    await p.tick()
    expect(p.control.at(-1)).not.toBe(true)
    expect(p.codes.at(-1)).toBe(null)
  })

  it('without the Mac app there is no control and no code', async () => {
    const p = await pair({ link: true, canControl: false })
    expect(p.unlock.some((u) => u.can)).toBe(false)
    expect(p.viewer.askForCode()).toBe(false)
    expect(p.codes).toEqual([])
  })
})
