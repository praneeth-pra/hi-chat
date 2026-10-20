// Remote camera, sending side (the /camera page on the remote laptop): offers
// its camera and microphone to every Meet tab running the Hi-chat extension,
// over WebRTC. relay/camera.mjs passes the connection setup between them.

export type CameraStatus = {
  connected: boolean // to Hi-chat's server
  viewers: number // Meet tabs receiving the camera
}

const MAX_VIDEO_BITRATE = 2_500_000

export function cameraSocketUrl(
  location: Pick<Location, 'protocol' | 'host'>,
  key: string
) {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}/api/camera?role=send&key=${encodeURIComponent(key)}`
}

/** Starts offering `stream`; returns controls to swap it or stop. */
export function startCameraSender({
  stream,
  key,
  location = globalThis.location,
  onStatus = () => {},
  WebSocketImpl = globalThis.WebSocket,
  PeerConnection = globalThis.RTCPeerConnection,
}: {
  stream: MediaStream
  key: string
  location?: Pick<Location, 'protocol' | 'host'>
  onStatus?: (s: CameraStatus) => void
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
    status()
  }

  async function offer(id: string) {
    drop(id)
    const pc = new PeerConnection({ iceServers: ice })
    peers.set(id, pc)
    for (const track of current.getTracks()) pc.addTrack(track, current)
    pc.onicecandidate = (e) =>
      send({ t: 'ice', to: id, candidate: e.candidate?.toJSON() ?? null })
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') drop(id)
      else status()
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
  }) {
    if (m.t === 'hello') ice = Array.isArray(m.ice) ? m.ice : []
    else if (m.t === 'join' && m.from) await offer(m.from)
    else if (m.t === 'leave' && m.from) drop(m.from)
    else if (m.t === 'answer' && m.from && m.sdp)
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
    const socket = new WebSocketImpl(cameraSocketUrl(location, key))
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
    socket.onclose = () => {
      if (ws !== socket) return
      ws = null
      for (const id of [...peers.keys()]) drop(id)
      status()
      if (stopped) return
      retry = setTimeout(connect, retryMs)
      retryMs = Math.min(retryMs * 2, 15_000)
    }
  }

  const ping = setInterval(() => send({ t: 'ping' }), 25_000)
  connect()

  return {
    /** Swaps in another camera or microphone without reconnecting. */
    replace(next: MediaStream) {
      current = next
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
  `// Filled in by Hi-chat's /camera page. Keep this folder private: the key\n` +
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
