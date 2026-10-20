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

export function createCameraHub({ env = process.env, log = console.log } = {}) {
  let sender = null
  const viewers = new Map() // id → socket

  const hello = (ws, extra) =>
    ws.send(JSON.stringify({ t: 'hello', ice: iceServers(env), ...extra }))

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

  function joinSender(ws) {
    // A newer camera page replaces the old one
    if (sender) sender.close(4000)
    sender = ws
    log(`camera: sender on, ${viewers.size} viewer(s)`)
    hello(ws)
    for (const id of viewers.keys())
      ws.send(JSON.stringify({ t: 'join', from: id }))
    for (const v of viewers.values())
      v.send(JSON.stringify({ t: 'sender', on: true }))
    ws.onmessage = (raw) => {
      const m = parse(raw)
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

  function joinViewer(ws) {
    const id = randomBytes(8).toString('hex')
    viewers.set(id, ws)
    hello(ws, { sender: sender !== null })
    sender?.send(JSON.stringify({ t: 'join', from: id }))
    ws.onmessage = (raw) => {
      const m = parse(raw)
      const out = m && signal(m)
      if (out && sender) sender.send(JSON.stringify({ ...out, from: id }))
    }
    ws.onclose = () => {
      viewers.delete(id)
      sender?.send(JSON.stringify({ t: 'leave', from: id }))
    }
  }

  return {
    join(ws, role) {
      if (role === 'send') joinSender(ws)
      else joinViewer(ws)
    },
    get counts() {
      return { sender: sender !== null, viewers: viewers.size }
    },
  }
}
