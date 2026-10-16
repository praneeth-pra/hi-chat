// Grok live: browsers can't open xAI's streaming speech-to-text socket
// themselves (it needs the API key in a header), so the relay accepts the
// browser's WebSocket at /api/grok-live and pipes it to wss://api.x.ai/v1/stt,
// adding XAI_API_KEY. The browser connects with a single-use ticket from
// /api/live-token (server.mjs checks it before the upgrade reaches here).
//
// Node has a WebSocket client but no server, so this is a minimal RFC 6455
// server: unfragmented-or-continued frames, masked from the client, never
// masked to it.

import { createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_MESSAGE_BYTES = 1024 * 1024

export const GROK_LIVE_URL = 'wss://api.x.ai/v1/stt'
export const MUSE_LIVE_URL = 'wss://api.meta.ai/v1/asr/realtime'
export const MUSE_MODEL = 'muse-voice-transcribe-1.0'
const MUSE_KEYWORD_CHARS = 30

/** xAI accepts up to 100 key terms of up to 50 characters each. */
export function cleanKeyterms(terms) {
  const seen = new Set()
  const out = []
  for (const raw of terms) {
    const term = String(raw).replace(/\s+/g, ' ').trim()
    if (!term || term.length > 50 || seen.has(term.toLowerCase())) continue
    seen.add(term.toLowerCase())
    out.push(term)
    if (out.length === 100) break
  }
  return out
}

/** One WebSocket frame to the browser (server frames are never masked). */
export function encodeFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  const len = body.length
  const head =
    len < 126
      ? Buffer.from([0x80 | opcode, len])
      : len < 65536
        ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 0xff])
        : (() => {
            const h = Buffer.alloc(10)
            h[0] = 0x80 | opcode
            h[1] = 127
            h.writeBigUInt64BE(BigInt(len), 2)
            return h
          })()
  return Buffer.concat([head, body])
}

/**
 * Splits buffered bytes into frames. Returns the frames read and the bytes
 * left over (an incomplete frame).
 */
export function decodeFrames(buf) {
  const frames = []
  let offset = 0
  while (buf.length - offset >= 2) {
    const b0 = buf[offset]
    const b1 = buf[offset + 1]
    let len = b1 & 0x7f
    let pos = offset + 2
    if (len === 126) {
      if (buf.length - pos < 2) break
      len = buf.readUInt16BE(pos)
      pos += 2
    } else if (len === 127) {
      if (buf.length - pos < 8) break
      len = Number(buf.readBigUInt64BE(pos))
      pos += 8
    }
    const masked = (b1 & 0x80) !== 0
    if (len > MAX_MESSAGE_BYTES) throw new Error('Frame too large')
    if (buf.length - pos < (masked ? 4 : 0) + len) break
    let payload
    if (masked) {
      const mask = buf.subarray(pos, pos + 4)
      pos += 4
      payload = Buffer.alloc(len)
      for (let i = 0; i < len; i++) payload[i] = buf[pos + i] ^ mask[i & 3]
    } else payload = Buffer.from(buf.subarray(pos, pos + len))
    pos += len
    frames.push({
      fin: (b0 & 0x80) !== 0,
      opcode: b0 & 0x0f,
      rsv: b0 & 0x70,
      masked,
      payload,
    })
    offset = pos
  }
  return { frames, rest: buf.subarray(offset) }
}

/**
 * Completes the upgrade and returns a small socket wrapper:
 * { send(text|Buffer), close(), onmessage(data, isBinary), onclose() }.
 */
export function acceptWebSocket(req, socket, head) {
  const key = req.headers['sec-websocket-key']
  if (
    !/^[A-Za-z0-9+/]{22}==$/.test(key ?? '') ||
    req.headers['sec-websocket-version'] !== '13' ||
    req.headers.upgrade?.toLowerCase() !== 'websocket'
  ) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
    return null
  }
  const accept = createHash('sha1')
    .update(key + GUID)
    .digest('base64')
  // If the browser offers a subprotocol it must be echoed
  const protocol = String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')[0]
    .trim()
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      (protocol ? `Sec-WebSocket-Protocol: ${protocol}\r\n` : '') +
      '\r\n'
  )
  socket.setNoDelay(true)

  let closed = false
  let buf = head?.length ? Buffer.from(head) : Buffer.alloc(0)
  let parts = []
  let partsOpcode = 0
  let partsBytes = 0
  const ws = {
    onmessage: () => {},
    onclose: () => {},
    send(data) {
      if (closed) return
      if (Buffer.byteLength(data) + socket.writableLength > MAX_MESSAGE_BYTES)
        return ws.close(1009)
      socket.write(
        typeof data === 'string' ? encodeFrame(1, data) : encodeFrame(2, data)
      )
    },
    close(code = 1000) {
      if (closed) return
      closed = true
      const body = Buffer.alloc(2)
      body.writeUInt16BE(code)
      socket.end(encodeFrame(8, body))
      ws.onclose()
    },
  }
  const onData = (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
    let frames
    try {
      ;({ frames, rest: buf } = decodeFrames(buf))
    } catch {
      return ws.close(1009)
    }
    for (const f of frames) {
      if (closed) return
      if (
        !f.masked ||
        f.rsv ||
        ![0, 1, 2, 8, 9, 10].includes(f.opcode) ||
        (f.opcode >= 8 && (!f.fin || f.payload.length > 125))
      )
        return ws.close(1002)
      if (f.opcode === 8) return ws.close()
      if (f.opcode === 9) {
        socket.write(encodeFrame(10, f.payload))
        continue
      }
      if (f.opcode === 10) continue
      if ((f.opcode === 0 && !partsOpcode) || (f.opcode !== 0 && partsOpcode))
        return ws.close(1002)
      if (f.opcode !== 0) partsOpcode = f.opcode
      partsBytes += f.payload.length
      if (partsBytes > MAX_MESSAGE_BYTES || parts.length >= 1024)
        return ws.close(1009)
      parts.push(f.payload)
      if (!f.fin) continue
      const data = Buffer.concat(parts)
      const opcode = partsOpcode
      parts = []
      partsBytes = 0
      partsOpcode = 0
      ws.onmessage(opcode === 1 ? data.toString('utf8') : data, opcode === 2)
    }
  }
  socket.on('data', onData)
  socket.on('close', () => {
    if (closed) return
    closed = true
    ws.onclose()
  })
  socket.on('error', () => socket.destroy())
  // Let grokLive attach its callbacks before delivering upgrade-head audio.
  if (buf.length)
    queueMicrotask(() => {
      if (!closed) onData(Buffer.alloc(0))
    })
  return ws
}

/**
 * Pipes one browser socket to xAI streaming STT. Audio and control messages
 * are held until xAI says it is ready (transcript.created).
 */
export function grokLive(
  client,
  {
    env = process.env,
    WebSocketImpl = globalThis.WebSocket,
    log = console.log,
    keyterms = [],
  } = {}
) {
  const started = Date.now()
  const key = env.XAI_API_KEY
  if (!key || !WebSocketImpl) {
    client.send(
      JSON.stringify({
        type: 'error',
        message: key ? 'WebSocket client unavailable' : 'XAI_API_KEY not set',
      })
    )
    return client.close(1011)
  }
  const params = new URLSearchParams({
    model: 'grok-voice-transcribe-2.0',
    encoding: 'pcm',
    sample_rate: '16000',
    language: 'en',
  })
  // Words to bias transcription toward (the assistant's key terms)
  for (const term of keyterms) params.append('keyterm', term)
  const upstream = new WebSocketImpl(`${GROK_LIVE_URL}?${params}`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  upstream.binaryType = 'arraybuffer'
  let ready = false
  const held = []
  let heldBytes = 0
  let done = false
  const readiness = setTimeout(() => finish('readiness timeout'), 10_000)
  readiness.unref?.()
  const finish = (why) => {
    if (done) return
    done = true
    clearTimeout(readiness)
    held.length = 0
    heldBytes = 0
    log(`grok live ${why} after ${Date.now() - started} ms`)
    try {
      upstream.close()
    } catch {
      // Already closed
    }
    client.close()
  }
  client.onmessage = (data) => {
    if (done) return
    const size =
      typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
    if (
      (ready ? upstream.bufferedAmount : heldBytes) + size >
      MAX_MESSAGE_BYTES
    )
      return finish('audio backlog exceeded')
    if (ready && upstream.readyState === 1) upstream.send(data)
    else {
      held.push(data)
      heldBytes += size
    }
  }
  client.onclose = () => finish('closed by browser')
  upstream.onmessage = (e) => {
    if (done) return
    const text =
      typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8')
    client.send(text)
    if (!ready && text.includes('"transcript.created"')) {
      ready = true
      clearTimeout(readiness)
      log(
        `grok live ready in ${Date.now() - started} ms` +
          (keyterms.length ? ` (${keyterms.length} key terms)` : '')
      )
      for (const msg of held.splice(0)) upstream.send(msg)
      heldBytes = 0
    }
  }
  upstream.onerror = () => {
    client.send(
      JSON.stringify({ type: 'error', message: 'Grok live connection failed' })
    )
    finish('failed')
  }
  upstream.onclose = () => finish('done')
}

/**
 * Pipes one browser socket to Meta's Muse Voice Transcribe. Meta takes the
 * key in the first message (the handshake), so the relay sends it, then
 * holds the browser's audio until Meta answers with a sessionId. One clip is
 * one push-to-talk session: the browser's {"type":"endStream"} ends it and
 * Meta replies with the final transcript, then closes.
 */
export function museLive(
  client,
  {
    env = process.env,
    WebSocketImpl = globalThis.WebSocket,
    log = console.log,
    keyterms = [],
  } = {}
) {
  const started = Date.now()
  const key = env.META_API_KEY
  if (!key || !WebSocketImpl) {
    client.send(
      JSON.stringify({
        type: 'error',
        message: key ? 'WebSocket client unavailable' : 'META_API_KEY not set',
      })
    )
    return client.close(1011)
  }
  // Meta rejects the whole session if any keyword is over 30 characters
  const keywords = keyterms.filter((term) => term.length <= MUSE_KEYWORD_CHARS)
  const upstream = new WebSocketImpl(MUSE_LIVE_URL)
  upstream.binaryType = 'arraybuffer'
  let ready = false
  const held = []
  let heldBytes = 0
  let done = false
  const readiness = setTimeout(() => finish('readiness timeout'), 10_000)
  readiness.unref?.()
  const finish = (why) => {
    if (done) return
    done = true
    clearTimeout(readiness)
    held.length = 0
    heldBytes = 0
    log(`muse live ${why} after ${Date.now() - started} ms`)
    try {
      upstream.close()
    } catch {
      // Already closed
    }
    client.close()
  }
  upstream.onopen = () => {
    upstream.send(
      JSON.stringify({
        authorization: { accessToken: `Bearer ${key}` },
        audioEncoding: 'PCM_16KHZ',
        model: MUSE_MODEL,
        mode: 'PUSH_TO_TALK',
        partialMode: 'CUMULATIVE',
        emitAudioProgress: false,
        languageBias: ['English'],
        // Words to bias transcription toward (the assistant's key terms)
        ...(keywords.length ? { keywords } : {}),
      })
    )
  }
  client.onmessage = (data) => {
    if (done) return
    const size =
      typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
    if (
      (ready ? upstream.bufferedAmount : heldBytes) + size >
      MAX_MESSAGE_BYTES
    )
      return finish('audio backlog exceeded')
    if (ready && upstream.readyState === 1) upstream.send(data)
    else {
      held.push(data)
      heldBytes += size
    }
  }
  client.onclose = () => finish('closed by browser')
  upstream.onmessage = (e) => {
    if (done) return
    const text =
      typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8')
    let reply = {}
    try {
      reply = JSON.parse(text)
    } catch {
      // Not JSON: passed on below
    }
    // Meta's errors say what was wrong with the request (never speech text)
    if (reply.type === 'error')
      log(
        `muse live error: ${String(reply.errorCode ?? reply.errorType ?? '')} ${String(reply.message ?? '').slice(0, 300)}`.trim()
      )
    if (!ready) {
      if (reply.sessionId && !reply.type) {
        ready = true
        clearTimeout(readiness)
        log(
          `muse live ready in ${Date.now() - started} ms` +
            (keywords.length ? ` (${keywords.length} key terms)` : '')
        )
        client.send(JSON.stringify({ type: 'ready' }))
        for (const msg of held.splice(0)) upstream.send(msg)
        heldBytes = 0
        return
      }
    }
    client.send(text)
  }
  upstream.onerror = () => {
    client.send(
      JSON.stringify({ type: 'error', message: 'Muse live connection failed' })
    )
    finish('failed')
  }
  upstream.onclose = (e) =>
    finish(
      `done (${e?.code ?? 'closed'}${e?.reason ? ` ${String(e.reason).slice(0, 200)}` : ''})`
    )
}
