// Remote camera, sending side (/mirror's camera panel on the remote laptop): offers
// its camera and microphone to every Meet tab running the Hi-chat extension,
// over WebRTC. relay/camera.mjs passes the connection setup between them.
// Each connection also has one video lane the other way: a Meet tab that is
// presenting sends its shared screen back on it, for /mirror to show.

export type CameraStatus = {
  connected: boolean // to Hi-chat's server
  viewers: number // Meet tabs receiving the camera
  /** Another page took the camera over: this one stopped for good */
  replaced?: boolean
}

const MAX_VIDEO_BITRATE = 2_500_000

/** Counters of a screen lane's inbound video, as getStats reports them. */
export type ScreenCounters = {
  framesDecoded: number
  jitterBufferDelay: number
  jitterBufferEmittedCount: number
  totalDecodeTime: number
}

/**
 * How the shared screen arrives on /mirror: frames a second, the network
 * (round trip), the time a frame waits to play and to decode, whether it
 * comes through a relay, and an estimate of how long a change on the shared
 * computer takes to show here (half the round trip, half a frame interval
 * waiting to be captured, the wait to play and the decode).
 */
export type ScreenStats = {
  fps: number
  rttMs: number | null
  bufferMs: number
  decodeMs: number
  relay: boolean
  estimateMs: number | null
}

/** The screen lane's counters, round trip and route from a stats report. */
export function readScreenStats(report: RTCStatsReport): {
  counters: ScreenCounters
  rttMs: number | null
  relay: boolean
} | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let inbound: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pair: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  report.forEach((s: any) => {
    if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s
    if (
      s.type === 'candidate-pair' &&
      s.state === 'succeeded' &&
      (s.nominated || s.selected) &&
      (!pair || s.selected)
    )
      pair = s
  })
  if (!inbound) return null
  const kind = (id?: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    id ? (report.get(id) as any)?.candidateType : undefined
  return {
    counters: {
      framesDecoded: inbound.framesDecoded ?? 0,
      jitterBufferDelay: inbound.jitterBufferDelay ?? 0,
      jitterBufferEmittedCount: inbound.jitterBufferEmittedCount ?? 0,
      totalDecodeTime: inbound.totalDecodeTime ?? 0,
    },
    rttMs:
      typeof pair?.currentRoundTripTime === 'number'
        ? Math.round(pair.currentRoundTripTime * 1000)
        : null,
    relay:
      kind(pair?.localCandidateId) === 'relay' ||
      kind(pair?.remoteCandidateId) === 'relay',
  }
}

/** The figures over the time between two reads (from the start if none). */
export function screenStatsBetween(
  prev: { s: ScreenCounters; at: number } | null,
  now: { s: ScreenCounters; at: number },
  rttMs: number | null,
  relay: boolean
): ScreenStats {
  const a = prev?.s ?? {
    framesDecoded: 0,
    jitterBufferDelay: 0,
    jitterBufferEmittedCount: 0,
    totalDecodeTime: 0,
  }
  const b = now.s
  const frames = b.framesDecoded - a.framesDecoded
  const emitted = b.jitterBufferEmittedCount - a.jitterBufferEmittedCount
  const seconds = prev ? (now.at - prev.at) / 1000 : 0
  const fps = seconds > 0 ? Math.max(0, frames / seconds) : 0
  const bufferMs =
    emitted > 0
      ? ((b.jitterBufferDelay - a.jitterBufferDelay) / emitted) * 1000
      : 0
  const decodeMs =
    frames > 0 ? ((b.totalDecodeTime - a.totalDecodeTime) / frames) * 1000 : 0
  const frameWait = fps > 0 ? 1000 / fps / 2 : 0
  return {
    fps: Math.round(fps),
    rttMs,
    bufferMs: Math.round(bufferMs),
    decodeMs: Math.round(decodeMs),
    relay,
    estimateMs:
      rttMs === null
        ? null
        : Math.round(rttMs / 2 + frameWait + bufferMs + decodeMs),
  }
}

export function cameraSocketUrl(
  location: Pick<Location, 'protocol' | 'host'>,
  key: string,
  link?: string
) {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base = `${scheme}//${location.host}/api/camera?role=send`
  // On a mirror link (no login, so no camera key) the link stands in
  return link
    ? `${base}&link=${encodeURIComponent(link)}`
    : `${base}&key=${encodeURIComponent(key)}`
}

/** Starts offering `stream`; returns controls to swap it or stop. */
export function startCameraSender({
  stream,
  key,
  link,
  location = globalThis.location,
  onStatus = () => {},
  onScreen = () => {},
  onCall = () => {},
  WebSocketImpl = globalThis.WebSocket,
  PeerConnection = globalThis.RTCPeerConnection,
}: {
  stream: MediaStream
  key: string
  /** A mirror link to send through instead of the camera key */
  link?: string
  location?: Pick<Location, 'protocol' | 'host'>
  onStatus?: (s: CameraStatus) => void
  /** The screen a Meet tab is presenting, or null when none is. */
  onScreen?: (screen: MediaStream | null) => void
  /** The sound of the Meet call (other participants), or null */
  onCall?: (call: MediaStream | null) => void
  WebSocketImpl?: typeof WebSocket
  PeerConnection?: typeof RTCPeerConnection
}) {
  let current = stream
  let ws: WebSocket | null = null
  let stopped = false
  let retryMs = 1000
  let retry: ReturnType<typeof setTimeout> | undefined
  let ice: RTCIceServer[] = []
  const peers = new Map<string, RTCPeerConnection>()
  let queue = Promise.resolve()
  // Each Meet tab's screen lane, and the tabs presenting, latest last
  const screens = new Map<string, MediaStream>()
  // Each screen lane's receiver: for its playout delay, and its stats
  const screenReceivers = new Map<string, RTCRtpReceiver>()
  let presenting: string[] = []
  // Someone controls the shared computer from here: its picture keeps its
  // frame rate over sharpness, with more bitrate (extension, 'fast')
  let fast = false
  // A shared screen plays each frame the moment it arrives: no buffer to
  // smooth it, which only adds delay to a screen (it has no sound to sync)
  const tuneScreen = (id: string) => {
    const r = screenReceivers.get(id) as unknown as
      Record<string, unknown> | undefined
    if (!r) return
    if ('jitterBufferTarget' in r) r.jitterBufferTarget = 0
    // Older Chrome: the same, in seconds
    else if ('playoutDelayHint' in r) r.playoutDelayHint = 0
  }
  // The last stats read, to measure the time between two reads
  let lastStats: { id: string; at: number; s: ScreenCounters } | null = null
  let shown: MediaStream | null = null
  // Each Meet tab's call sound; the latest tab to connect is heard
  const calls = new Map<string, MediaStream>()
  let heard: MediaStream | null = null
  function hearCall() {
    let next: MediaStream | null = null
    for (const c of calls.values()) next = c
    if (next === heard) return
    heard = next
    onCall(next)
  }

  function showScreen() {
    let next: MediaStream | null = null
    for (const p of presenting) next = screens.get(p) ?? next
    if (next === shown) return
    shown = next
    onScreen(next)
  }

  const status = () =>
    onStatus({
      connected: ws?.readyState === WebSocketImpl.OPEN,
      viewers: [...peers.values()].filter(
        (p) => p.connectionState === 'connected'
      ).length,
    })
  const send = (m: unknown) => {
    if (ws?.readyState === WebSocketImpl.OPEN) ws.send(JSON.stringify(m))
  }

  function drop(id: string) {
    peers.get(id)?.close()
    peers.delete(id)
    screens.delete(id)
    screenReceivers.delete(id)
    presenting = presenting.filter((p) => p !== id)
    showScreen()
    if (calls.delete(id)) hearCall()
    status()
  }

  // Tracks tuned for what they carry: a moving picture, and a voice
  const hint = (s: MediaStream) => {
    for (const t of s.getTracks())
      if (!t.contentHint)
        t.contentHint = t.kind === 'video' ? 'motion' : 'speech'
  }
  hint(current)
  // Viewers re-offered after their connection failed, until it connects again
  const retried = new Set<string>()

  async function offer(id: string) {
    drop(id)
    const pc = new PeerConnection({ iceServers: ice })
    peers.set(id, pc)
    for (const track of current.getTracks()) pc.addTrack(track, current)
    // The lane a presenting Meet tab sends its screen back on
    const lane = pc.addTransceiver('video', { direction: 'recvonly' })
    // And the lane the Meet call's sound comes back on
    const callLane = pc.addTransceiver('audio', { direction: 'recvonly' })
    pc.ontrack = (e) => {
      if (peers.get(id) !== pc) return
      if (e.transceiver === lane) {
        screens.set(id, new MediaStream([e.track]))
        screenReceivers.set(id, e.receiver)
        tuneScreen(id)
        showScreen()
      } else if (e.transceiver === callLane) {
        calls.delete(id) // the newest connection goes last
        calls.set(id, new MediaStream([e.track]))
        hearCall()
      }
    }
    pc.onicecandidate = (e) =>
      send({ t: 'ice', to: id, candidate: e.candidate?.toJSON() ?? null })
    pc.onconnectionstatechange = () => {
      if (peers.get(id) !== pc) return
      if (pc.connectionState === 'connected') retried.delete(id)
      if (pc.connectionState !== 'failed') return status()
      drop(id)
      // A network change on either side: connect again once, at once,
      // rather than leave Meet on a frozen picture until the tab rejoins
      if (!retried.has(id) && ws?.readyState === WebSocketImpl.OPEN) {
        retried.add(id)
        queue = queue.then(() => offer(id)).catch(() => {})
      }
    }
    for (const sender of pc.getSenders())
      if (sender.track?.kind === 'video') {
        const params = sender.getParameters()
        params.encodings = params.encodings?.length ? params.encodings : [{}]
        params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE
        await sender.setParameters(params).catch(() => {})
      }
    const desc = await pc.createOffer()
    await pc.setLocalDescription(desc)
    send({ t: 'offer', to: id, sdp: desc.sdp })
  }

  async function onSignal(m: {
    t?: string
    from?: string
    sdp?: string
    candidate?: RTCIceCandidateInit | null
    ice?: RTCIceServer[]
    on?: boolean
  }) {
    if (m.t === 'hello') ice = Array.isArray(m.ice) ? m.ice : []
    else if (m.t === 'join' && m.from) {
      // The same Meet tab again after a blip in the server connection: its
      // camera and sound never stopped, so they carry on as they are
      if (peers.get(m.from)?.connectionState === 'connected') return status()
      await offer(m.from)
    } else if (m.t === 'leave' && m.from) drop(m.from)
    else if (m.t === 'screen' && m.from) {
      const from = m.from
      presenting = presenting.filter((p) => p !== from)
      if (m.on === true && peers.has(from)) {
        presenting.push(from)
        // A presentation starting while someone controls: quick at once
        if (fast) send({ t: 'fast', to: from, on: true })
      }
      showScreen()
    } else if (m.t === 'answer' && m.from && m.sdp)
      await peers
        .get(m.from)
        ?.setRemoteDescription({ type: 'answer', sdp: m.sdp })
    else if (m.t === 'ice' && m.from)
      await peers
        .get(m.from)
        ?.addIceCandidate(m.candidate ?? undefined)
        .catch(() => {})
  }

  function connect() {
    if (stopped) return
    const socket = new WebSocketImpl(cameraSocketUrl(location, key, link))
    ws = socket
    socket.onopen = () => {
      retryMs = 1000
      status()
    }
    socket.onmessage = (e) => {
      let m
      try {
        m = JSON.parse(String(e.data))
      } catch {
        return
      }
      queue = queue.then(() => onSignal(m)).catch(() => {})
    }
    socket.onclose = (e?: { code?: number }) => {
      if (ws !== socket) return
      ws = null
      // Replaced by a newer camera page (relay/camera.mjs): stop, rather than
      // reconnect and take the camera back from it, over and over
      if (e?.code === 4000) {
        for (const id of [...peers.keys()]) drop(id)
        stopped = true
        clearInterval(ping)
        onStatus({ connected: false, viewers: 0, replaced: true })
        return
      }
      // Lost the server only: connections that are up keep going, as the
      // media goes directly between the browsers. Ones still being set up
      // can't finish without it, and start again when the tab rejoins
      for (const [id, pc] of [...peers])
        if (pc.connectionState !== 'connected') drop(id)
      status()
      if (stopped) return
      retry = setTimeout(connect, retryMs)
      retryMs = Math.min(retryMs * 2, 8_000)
    }
  }

  const ping = setInterval(() => send({ t: 'ping' }), 25_000)
  connect()

  return {
    /** How the shared screen is arriving now (see ScreenStats), or null. */
    async screenStats(): Promise<ScreenStats | null> {
      let id: string | undefined
      for (const p of presenting) if (screens.has(p)) id = p
      const r = id ? screenReceivers.get(id) : undefined
      if (!id || !r) return null
      const read = readScreenStats(await r.getStats())
      if (!read) return null
      const prev = lastStats?.id === id ? lastStats : null
      lastStats = { id, at: performance.now(), s: read.counters }
      return screenStatsBetween(
        prev && { s: prev.s, at: prev.at },
        { s: read.counters, at: lastStats.at },
        read.rttMs,
        read.relay
      )
    },
    /** The shared screen quick (30 fps, no playout delay) or as usual. */
    setFastScreen(on: boolean) {
      if (fast === on) return
      fast = on
      for (const id of peers.keys()) {
        send({ t: 'fast', to: id, on })
        tuneScreen(id)
      }
    },
    /** Swaps in another camera or microphone without reconnecting. */
    replace(next: MediaStream) {
      current = next
      hint(next)
      for (const pc of peers.values())
        for (const sender of pc.getSenders()) {
          const kind = sender.track?.kind
          const track = next.getTracks().find((t) => t.kind === kind)
          if (track) sender.replaceTrack(track).catch(() => {})
        }
    },
    stop() {
      stopped = true
      clearInterval(ping)
      clearTimeout(retry)
      for (const id of [...peers.keys()]) drop(id)
      ws?.close()
      ws = null
    },
  }
}

// The extension download: its files with the site and key filled in,
// packed as a .zip (stored, not compressed: the files are tiny).

export const EXTENSION_FILES = [
  'manifest.json',
  'background.js',
  'bridge.js',
  'page.js',
  'config.js',
]

export const extensionConfig = (site: string, key: string) =>
  `// Filled in by Hi-chat's /mirror page. Keep this folder private: the key\n` +
  `// lets Meet tabs on this computer receive the remote camera.\n` +
  `self.HICHAT_CAMERA = ${JSON.stringify({ site, key })}\n`

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array) {
  let c = 0xffffffff
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A .zip of `files` (path → contents), without compression. */
export function zipFiles(
  files: Record<string, string>
): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [path, text] of Object.entries(files)) {
    const name = enc.encode(path)
    const data = enc.encode(text)
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, name.length, true)
    const head = new DataView(new ArrayBuffer(46))
    head.setUint32(0, 0x02014b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 20, true)
    head.setUint16(8, 0x0800, true)
    head.setUint32(16, crc, true)
    head.setUint32(20, data.length, true)
    head.setUint32(24, data.length, true)
    head.setUint16(28, name.length, true)
    head.setUint32(42, offset, true)
    parts.push(new Uint8Array(local.buffer), name, data)
    central.push(new Uint8Array(head.buffer), name)
    offset += 30 + name.length + data.length
  }
  const size = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, Object.keys(files).length, true)
  end.setUint16(10, Object.keys(files).length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of all) {
    out.set(p, at)
    at += p.length
  }
  return out
}
