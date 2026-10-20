// Remote camera: a laptop elsewhere opens /mirror and sends its camera and
// microphone; the Hi-chat Chrome extension on another computer hands them to
// Google Meet as "Hi-chat remote camera" and "Hi-chat remote mic".
//
// The media goes directly between the two browsers (WebRTC). This hub only
// passes the connection setup (offers, answers, ICE candidates) between the
// one sender (the /mirror page's camera) and each viewer (a Meet tab). Both connect to
// /api/camera?role=send|view&key=… with the camera key (auth.mjs), because a
// Meet tab can't send Hi-chat's login cookie. The same connection carries the
// screen a Meet tab presents back to /mirror; the hub passes its on/off.

import { randomBytes } from 'node:crypto'

const MAX_SIGNAL = 64 * 1024
const VIEWER_ID = /^[\w-]{16,64}$/
const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }]

/**
 * STUN/TURN servers for both ends. CAMERA_ICE_SERVERS takes a JSON list of
 * RTCIceServer objects; a TURN server there lets the camera through networks
 * that block direct connections.
 */
export function iceServers(env = process.env) {
  try {
    const list = JSON.parse(env.CAMERA_ICE_SERVERS ?? '')
    if (Array.isArray(list) && list.length) return list
  } catch {
    // unset or not JSON
  }
  return DEFAULT_ICE
}

const TURN_TTL_S = 24 * 60 * 60
const TURN_TIMEOUT_MS = 2000

/**
 * ICE servers including Cloudflare TURN, when CLOUDFLARE_TURN_KEY_ID and
 * CLOUDFLARE_TURN_KEY_TOKEN are set: without a relay, a camera on a network
 * that blocks direct connections (offices, hotels, some mobile carriers)
 * never connects. The short-lived credentials are fetched once a day, then
 * refreshed in the background at half-life, so joining stays instant.
 * `ready()` is the list now, or null while the first fetch is under way.
 */
export function createIceSource({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  log = console.log,
} = {}) {
  const id = env.CLOUDFLARE_TURN_KEY_ID
  const token = env.CLOUDFLARE_TURN_KEY_TOKEN
  const base = iceServers(env)
  if (!id || !token || !/^[\w-]{1,128}$/.test(id)) {
    return { ready: () => base, load: async () => base }
  }
  let list = null
  let fetchedAt = 0
  let failedAt = -Infinity
  let loading = null

  function load() {
    loading ??= (async () => {
      try {
        const res = await fetchImpl(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ttl: TURN_TTL_S }),
            signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
          }
        )
        if (!res.ok) throw new Error(`status ${res.status}`)
        const got = (await res.json())?.iceServers
        const servers = (Array.isArray(got) ? got : [got])
          .filter((s) => s && typeof s === 'object')
          .map((s) => ({
            ...s,
            // Browsers refuse port 53; Cloudflare offers it for other clients
            urls: [].concat(s.urls ?? []).filter((u) => !/:53(?:\?|$)/.test(u)),
          }))
          .filter((s) => s.urls.length)
        if (!servers.length) throw new Error('no servers')
        list = servers
        fetchedAt = now()
      } catch (err) {
        failedAt = now()
        log(`camera: TURN credentials unavailable (${err?.message ?? err})`)
      } finally {
        loading = null
      }
      return list ?? base
    })()
    return loading
  }

  return {
    ready() {
      const age = now() - fetchedAt
      if (list && age < TURN_TTL_S * 1000) {
        if (age > (TURN_TTL_S * 1000) / 2) load()
        return list
      }
      // Cloudflare unreachable a moment ago: STUN only, rather than every
      // join waiting on it; tried again after a minute
      if (now() - failedAt < 60_000) return base
      return null
    },
    load,
  }
}

export function createCameraHub({
  env = process.env,
  log = console.log,
  ice = createIceSource({ env, log }),
} = {}) {
  let sender = null
  const viewers = new Map() // id → socket
  // Pings get a pong, so an idle socket stays open (nginx closes one that
  // hears nothing for 120 s)
  const pong = (ws, m) => m?.t === 'ping' && ws.send('{"t":"pong"}')

  const hello = (ws, list, extra) =>
    ws.send(JSON.stringify({ t: 'hello', ice: list, ...extra }))

  const parse = (raw) => {
    if (typeof raw !== 'string' || raw.length > MAX_SIGNAL) return null
    try {
      const m = JSON.parse(raw)
      return m && typeof m === 'object' ? m : null
    } catch {
      return null
    }
  }

  // Only connection-setup messages pass, with known fields
  const signal = (m) => {
    if (m.t === 'offer' || m.t === 'answer')
      return typeof m.sdp === 'string' ? { t: m.t, sdp: m.sdp } : null
    if (m.t === 'ice')
      return m.candidate === null || typeof m.candidate === 'object'
        ? { t: 'ice', candidate: m.candidate }
        : null
    // A Meet tab starting or stopping a presentation it sends to /mirror
    if (m.t === 'screen') return { t: 'screen', on: m.on === true }
    return null
  }

  function joinSender(ws, list) {
    // A newer camera page replaces the old one; it hears 4000 and stays off
    // (rather than reconnecting and taking the camera back, over and over)
    if (sender) sender.close(4000)
    sender = ws
    log(`camera: sender on, ${viewers.size} viewer(s)`)
    hello(ws, list)
    for (const id of viewers.keys())
      ws.send(JSON.stringify({ t: 'join', from: id }))
    for (const v of viewers.values())
      v.send(JSON.stringify({ t: 'sender', on: true }))
    ws.onmessage = (raw) => {
      const m = parse(raw)
      pong(ws, m)
      const out = m && signal(m)
      const to = m && viewers.get(m.to)
      if (out && to) to.send(JSON.stringify(out))
    }
    ws.onclose = () => {
      if (sender !== ws) return
      sender = null
      log('camera: sender off')
      for (const v of viewers.values())
        v.send(JSON.stringify({ t: 'sender', on: false }))
    }
  }

  function joinViewer(ws, list, vid) {
    // A Meet tab keeps its id across reconnects (the extension picks it), so
    // a blip in this server's connection doesn't cost it the camera: the
    // camera page sees the same viewer again and keeps the media it has.
    const id = VIEWER_ID.test(vid ?? '') ? vid : randomBytes(8).toString('hex')
    const was = viewers.get(id)
    viewers.set(id, ws)
    // The same tab's old socket, still open: it goes quietly
    if (was && was !== ws) {
      was.onclose = () => {}
      was.close()
    }
    hello(ws, list, { sender: sender !== null })
    sender?.send(JSON.stringify({ t: 'join', from: id }))
    ws.onmessage = (raw) => {
      const m = parse(raw)
      pong(ws, m)
      const out = m && signal(m)
      if (out && sender) sender.send(JSON.stringify({ ...out, from: id }))
    }
    ws.onclose = () => {
      if (viewers.get(id) !== ws) return
      viewers.delete(id)
      sender?.send(JSON.stringify({ t: 'leave', from: id }))
    }
  }

  return {
    join(ws, role, { vid } = {}) {
      const start = (list) =>
        role === 'send' ? joinSender(ws, list) : joinViewer(ws, list, vid)
      const list = ice.ready()
      if (list) return start(list)
      // The first join after a start waits for TURN credentials (2 s at
      // most), unless the socket closes first
      let gone = false
      ws.onclose = () => (gone = true)
      ice.load().then((l) => gone || start(l))
    },
    get counts() {
      return { sender: sender !== null, viewers: viewers.size }
    },
  }
}
