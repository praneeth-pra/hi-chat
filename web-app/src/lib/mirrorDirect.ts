// Direct mirror: a WebRTC data channel straight from Hi-chat to each /mirror
// viewer, so updates skip the trip through Hi-chat's server. The server
// (relay/mirror.mjs) only introduces the two ends and passes the setup.
//
// Every update still goes through the server too, tagged with the sender's
// session `s` and a sequence number `q`. The viewer applies each `q` once,
// in order, usually from the direct route (createSeqFilter), so the direct
// channel failing, or never opening, loses nothing.

/** Updates that carry a sequence number (images go by key, server only). */
export const SEQUENCED = new Set(['snap', 'ops', 'stream', 'phase', 'scroll'])

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

type Tagged = { s?: unknown; q?: unknown }

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

/**
 * Hi-chat's side: a data channel to each viewer the server introduces.
 * `signal` sends setup through the server; `onOpen` is told when a channel
 * opens.
 */
export function createDirectSender({
  signal,
  onOpen,
  PeerConnection = globalThis.RTCPeerConnection,
}: {
  signal: Signal
  onOpen?: () => void
  PeerConnection?: typeof RTCPeerConnection
}) {
  const peers = new Map<string, { pc: RTCPeerConnection; dc: RTCDataChannel }>()
  let queue = Promise.resolve()

  function close(id: string) {
    const p = peers.get(id)
    if (!p) return
    peers.delete(id)
    p.dc.close()
    p.pc.close()
  }

  async function start(id: string, ice: RTCIceServer[]) {
    close(id)
    const pc = new PeerConnection({ iceServers: ice.length ? ice : STUN })
    // In order and reliable, as updates build on each other
    const dc = pc.createDataChannel('mirror', { ordered: true })
    peers.set(id, { pc, dc })
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
    dc.onopen = () => mine() && onOpen?.()
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
      if (m.on === true) await start(m.id, Array.isArray(m.ice) ? m.ice : [])
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
export function createDirectViewer({
  signal,
  onMessage,
  onPong,
  onChange,
  PeerConnection = globalThis.RTCPeerConnection,
}: {
  signal: Signal
  onMessage: (m: Record<string, unknown>) => void
  onPong: (n: number) => void
  onChange: (open: number) => void
  PeerConnection?: typeof RTCPeerConnection
}) {
  const peers = new Map<
    string,
    { pc: RTCPeerConnection; dc: RTCDataChannel | null }
  >()
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
    p.pc.close()
    onChange(openCount())
  }

  async function answer(from: string, sdp: string, ice: RTCIceServer[]) {
    close(from)
    const pc = new PeerConnection({ iceServers: ice.length ? ice : STUN })
    const entry: { pc: RTCPeerConnection; dc: RTCDataChannel | null } = {
      pc,
      dc: null,
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
    closeAll() {
      for (const id of [...peers.keys()]) close(id)
    },
  }
}
