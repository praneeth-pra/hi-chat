// Direct mirror: a WebRTC data channel straight from Hi-chat to each /mirror
// viewer, so updates skip the trip through Hi-chat's server. The server
// (relay/mirror.mjs) only introduces the two ends and passes the setup.
//
// Every update still goes through the server too, tagged with the sender's
// session `s` and a sequence number `q`. The viewer applies each `q` once,
// in order, usually from the direct route (createSeqFilter), so the direct
// channel failing, or never opening, loses nothing.

/** Updates that carry a sequence number (images go by key, server only). */
export const SEQUENCED = new Set([
  'snap',
  'ops',
  'stream',
  'phase',
  'scroll',
  'shown',
  'look',
  'typing',
])

// Data channel messages much over 64 KB aren't safe everywhere: a longer one
// goes in pieces, `~` for each but the last and `!` for the last
const CHUNK = 60_000

/** `data` as data channel messages: itself, or pieces. */
export function chunks(data: string): string[] {
  if (data.length <= CHUNK) return [data]
  const out: string[] = []
  for (let i = 0; i < data.length; i += CHUNK)
    out.push((i + CHUNK >= data.length ? '!' : '~') + data.slice(i, i + CHUNK))
  return out
}

/** Puts pieces back together; calls `done` with each whole message. */
export function createUnchunker(done: (data: string) => void) {
  let buf = ''
  return (piece: string) => {
    if (piece[0] === '~') buf += piece.slice(1)
    else if (piece[0] === '!') {
      const whole = buf + piece.slice(1)
      buf = ''
      done(whole)
    } else {
      buf = ''
      done(piece)
    }
  }
}

type Tagged = { t?: unknown; s?: unknown; q?: unknown }

// Direct copies held while they wait for an earlier update, per sender
const MAX_HELD = 500

/**
 * Decides which copy of each update the viewer applies, and when. Both routes
 * keep their order. The server route carries every update since the viewer
 * joined, so its copy applies when it is newer than the last applied. The
 * direct route carries updates only from when it opened, so its copy applies
 * only as the next one; one that arrives early is held until the updates
 * before it are in. Every update applies once, in order.
 */
export function createSeqFilter() {
  const last = new Map<string, number>()
  const held = new Map<string, Map<number, Tagged>>()
  return {
    /** The updates to apply now (none, `m`, or `m` and held ones after it). */
    take<T extends Tagged>(m: T, via: 'relay' | 'direct'): T[] {
      const s = m.s
      const q = m.q
      // Untagged: the server's catch-up for a new viewer, an image, or an
      // older Hi-chat
      if (typeof s !== 'string' || typeof q !== 'number') return [m]
      let seen = last.get(s) ?? -1
      if (q <= seen) return []
      let wait = held.get(s)
      if (via === 'direct' && q > seen + 1) {
        if (!wait) held.set(s, (wait = new Map()))
        if (wait.size < MAX_HELD) wait.set(q, m)
        return []
      }
      const out: T[] = [m]
      seen = q
      // Held direct copies that can follow now
      if (wait) {
        for (const k of wait.keys()) if (k <= seen) wait.delete(k)
        while (wait.has(seen + 1)) {
          out.push(wait.get(seen + 1) as T)
          wait.delete(++seen)
        }
      }
      last.set(s, seen)
      return out
    },
  }
}

const STUN: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
// A channel this far behind is slower than the server: it closes, and the
// server route carries on alone
const MAX_BUFFERED = 1_000_000

type Signal = (m: Record<string, unknown>) => void
type RtcMessage = {
  t?: string
  from?: string
  type?: string
  sdp?: string
  candidate?: RTCIceCandidateInit | null
  ice?: RTCIceServer[]
}

/** A mouse or key action from /mirror, for the Mac app to replay. */
export type RemoteInput = Record<string, unknown> & { k: string }

/**
 * Hi-chat's side: a data channel to each viewer the server introduces.
 * `signal` sends setup through the server; `onOpen` is told when a channel
 * opens. With `canControl` (the Mac app), signed-in viewers may also send
 * mouse and key actions (`onInput`) on a second channel of their own, so
 * they never wait behind a long update.
 */
export function createDirectSender({
  signal,
  onOpen,
  canControl = false,
  onInput,
  PeerConnection = globalThis.RTCPeerConnection,
}: {
  signal: Signal
  onOpen?: () => void
  canControl?: boolean
  onInput?: (m: RemoteInput) => void
  PeerConnection?: typeof RTCPeerConnection
}) {
  const peers = new Map<
    string,
    {
      pc: RTCPeerConnection
      dc: RTCDataChannel
      input: RTCDataChannel
      moves: RTCDataChannel
    }
  >()
  let queue = Promise.resolve()

  function close(id: string) {
    const p = peers.get(id)
    if (!p) return
    peers.delete(id)
    p.dc.close()
    p.input.close()
    p.moves.close()
    p.pc.close()
  }

  async function start(id: string, ice: RTCIceServer[], link: boolean) {
    close(id)
    const pc = new PeerConnection({ iceServers: ice.length ? ice : STUN })
    // In order and reliable, as updates build on each other
    const dc = pc.createDataChannel('mirror', { ordered: true })
    // Mouse and keys from the viewer: in order (a key's up after its down)
    const input = pc.createDataChannel('input', { ordered: true })
    // Pointer moves only: never resent and never waiting for an earlier one,
    // as the next move replaces a lost one; numbered, so a late one is dropped
    const moves = pc.createDataChannel('moves', {
      ordered: false,
      maxRetransmits: 0,
    })
    peers.set(id, { pc, dc, input, moves })
    // Never from a link's viewer (no login)
    const control = canControl && !link
    const mine = () => peers.get(id)?.pc === pc
    pc.onicecandidate = (e) =>
      mine() &&
      signal({ t: 'rtc', to: id, candidate: e.candidate?.toJSON() ?? null })
    pc.onconnectionstatechange = () => {
      if (mine() && pc.connectionState === 'failed') close(id)
    }
    const send = (data: string) => {
      if (dc.readyState === 'open') for (const c of chunks(data)) dc.send(c)
    }
    dc.onopen = () => {
      if (!mine()) return
      // Whether this viewer may control the computer
      send(JSON.stringify({ t: 'hello', control }))
      onOpen?.()
    }
    const take = (data: string) => {
      if (!control || !mine() || data.length > 2000) return null
      try {
        const m = JSON.parse(data)
        return m && typeof m === 'object' && typeof m.k === 'string' ? m : null
      } catch {
        return null // not an action
      }
    }
    input.onmessage = (e) => {
      const m = take(String(e.data))
      if (m) onInput?.(m)
    }
    let lastMove = -1
    moves.onmessage = (e) => {
      const m = take(String(e.data))
      if (!m || m.k !== 'm' || typeof m.n !== 'number' || m.n <= lastMove)
        return
      lastMove = m.n
      delete m.n
      onInput?.(m)
    }
    dc.onclose = () => mine() && close(id)
    // A viewer times the direct route with pings
    dc.onmessage = (e) => {
      const data = String(e.data)
      if (data.length > 200) return
      try {
        const m = JSON.parse(data)
        if (m?.t === 'ping' && typeof m.n === 'number')
          send(JSON.stringify({ t: 'pong', n: m.n }))
      } catch {
        // not a ping
      }
    }
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    if (mine()) signal({ t: 'rtc', to: id, type: 'offer', sdp: offer.sdp })
  }

  async function handle(m: RtcMessage & { id?: string; on?: boolean }) {
    if (m.t === 'peer' && typeof m.id === 'string') {
      if (m.on === true)
        await start(
          m.id,
          Array.isArray(m.ice) ? m.ice : [],
          (m as { link?: unknown }).link === true
        )
      else close(m.id)
      return
    }
    if (m.t !== 'rtc' || typeof m.from !== 'string') return
    const p = peers.get(m.from)
    if (!p) return
    if (m.type === 'answer' && typeof m.sdp === 'string')
      await p.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp })
    else if ('candidate' in m)
      await p.pc.addIceCandidate(m.candidate ?? undefined).catch(() => {})
  }

  return {
    /** A 'peer' or 'rtc' message from the server. */
    receive(m: RtcMessage & { id?: string; on?: boolean }) {
      if (!PeerConnection) return
      queue = queue.then(() => handle(m)).catch(() => {})
    },
    /** Sends an update to every viewer with an open channel. */
    broadcast(data: string) {
      for (const [id, { dc }] of peers) {
        if (dc.readyState !== 'open') continue
        if (dc.bufferedAmount > MAX_BUFFERED) close(id)
        else for (const c of chunks(data)) dc.send(c)
      }
    },
    /** How many viewers have an open channel. */
    get open() {
      let n = 0
      for (const { dc } of peers.values()) if (dc.readyState === 'open') n++
      return n
    },
    closeAll() {
      for (const id of [...peers.keys()]) close(id)
    },
  }
}

/**
 * The viewer's side: answers each sender's offer, and passes on what its
 * channel brings: updates (`onMessage`), pongs (`onPong`), and how many
 * channels are open (`onChange`).
 */
type ViewerPeer = {
  pc: RTCPeerConnection
  dc: RTCDataChannel | null
  input: RTCDataChannel | null
  /** Pointer moves, lossy and unordered */
  moves: RTCDataChannel | null
  /** The sender lets this page control its computer */
  control: boolean
}

export function createDirectViewer({
  signal,
  onMessage,
  onPong,
  onChange,
  onControl = () => {},
  PeerConnection = globalThis.RTCPeerConnection,
}: {
  signal: Signal
  onMessage: (m: Record<string, unknown>) => void
  onPong: (n: number) => void
  onChange: (open: number) => void
  /** Whether a connected Hi-chat can be controlled from here */
  onControl?: (can: boolean) => void
  PeerConnection?: typeof RTCPeerConnection
}) {
  const peers = new Map<string, ViewerPeer>()
  // The Hi-chat mouse and key actions go to, if any
  const controlPeer = () => {
    for (const p of peers.values())
      if (p.control && p.input?.readyState === 'open') return p
    return null
  }
  const controlChannel = () => controlPeer()?.input ?? null
  let moveCount = 0
  let couldControl = false
  const noteControl = () => {
    const can = controlChannel() !== null
    if (can !== couldControl) onControl((couldControl = can))
  }
  let queue = Promise.resolve()
  const openCount = () => {
    let n = 0
    for (const { dc } of peers.values()) if (dc?.readyState === 'open') n++
    return n
  }

  function close(id: string) {
    const p = peers.get(id)
    if (!p) return
    peers.delete(id)
    p.dc?.close()
    p.input?.close()
    p.moves?.close()
    p.pc.close()
    onChange(openCount())
    noteControl()
  }

  async function answer(from: string, sdp: string, ice: RTCIceServer[]) {
    close(from)
    const pc = new PeerConnection({ iceServers: ice.length ? ice : STUN })
    const entry: ViewerPeer = {
      pc,
      dc: null,
      input: null,
      moves: null,
      control: false,
    }
    peers.set(from, entry)
    const mine = () => peers.get(from) === entry
    pc.onicecandidate = (e) =>
      mine() &&
      signal({ t: 'rtc', to: from, candidate: e.candidate?.toJSON() ?? null })
    pc.onconnectionstatechange = () => {
      if (mine() && pc.connectionState === 'failed') close(from)
    }
    pc.ondatachannel = (e) => {
      if (!mine()) return
      const dc = e.channel
      if (dc.label === 'moves') {
        entry.moves = dc
        return
      }
      if (dc.label === 'input') {
        entry.input = dc
        dc.onopen = () => mine() && noteControl()
        dc.onclose = () => mine() && noteControl()
        if (dc.readyState === 'open') noteControl()
        return
      }
      entry.dc = dc
      const take = createUnchunker((data) => {
        let m
        try {
          m = JSON.parse(data)
        } catch {
          return
        }
        if (!m || typeof m !== 'object') return
        if (m.t === 'pong') {
          if (typeof m.n === 'number') onPong(m.n)
        } else if (m.t === 'hello') {
          entry.control = m.control === true
          noteControl()
        } else onMessage(m)
      })
      dc.onmessage = (ev) => mine() && take(String(ev.data))
      dc.onopen = () => mine() && onChange(openCount())
      dc.onclose = () => mine() && close(from)
      if (dc.readyState === 'open') onChange(openCount())
    }
    await pc.setRemoteDescription({ type: 'offer', sdp })
    const reply = await pc.createAnswer()
    await pc.setLocalDescription(reply)
    if (mine()) signal({ t: 'rtc', to: from, type: 'answer', sdp: reply.sdp })
  }

  async function handle(m: RtcMessage) {
    if (m.t !== 'rtc' || typeof m.from !== 'string') return
    if (m.type === 'offer' && typeof m.sdp === 'string')
      return answer(m.from, m.sdp, Array.isArray(m.ice) ? m.ice : [])
    const p = peers.get(m.from)
    if (p && 'candidate' in m)
      await p.pc.addIceCandidate(m.candidate ?? undefined).catch(() => {})
  }

  return {
    /** An 'rtc' message from the server. */
    receive(m: RtcMessage) {
      if (!PeerConnection) return
      queue = queue.then(() => handle(m)).catch(() => {})
    },
    /** Pings over a direct channel; false when none is open. */
    ping(n: number) {
      for (const { dc } of peers.values())
        if (dc?.readyState === 'open') {
          dc.send(JSON.stringify({ t: 'ping', n }))
          return true
        }
      return false
    },
    get open() {
      return openCount()
    },
    /** Sends a mouse or key action to the Hi-chat that allows control. */
    sendInput(m: RemoteInput) {
      const p = controlPeer()
      if (!p?.input) return false
      // A pointer move on the lossy lane when there is one
      if (m.k === 'm' && p.moves?.readyState === 'open') {
        p.moves.send(JSON.stringify({ ...m, n: ++moveCount }))
        return true
      }
      p.input.send(JSON.stringify(m))
      return true
    },
    closeAll() {
      for (const id of [...peers.keys()]) close(id)
    },
  }
}
