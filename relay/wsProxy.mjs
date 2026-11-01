// The relay's WebSocket server, for the remote mirror and camera
// (mirror.mjs, camera.mjs).
//
// Node has a WebSocket client but no server, so this is a minimal RFC 6455
// server: unfragmented-or-continued frames, masked from the client, never
// masked to it.
//
// Backpressure: a viewer on a slow link must not make Node buffer without
// limit, so each socket has an outbound cap (bytes Node holds, not yet taken
// by the kernel). Past it the client is closed with 1013 ("try again later").
// Below it, `backpressured` says the client is behind, so callers can skip
// updates a newer one replaces (mirror.mjs does), and `ondrain` says it has
// caught up.
//
// Keepalive: the server pings (opcode 9) every 25 s, which browsers answer
// on their own, and drops a socket it hasn't heard anything from (a pong or
// any other frame) for 60 s. The apps' JSON pings still get their JSON pongs
// from mirror.mjs and camera.mjs.

import { createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_MESSAGE_BYTES = 1024 * 1024
/** Bytes Node may hold for one client before it is closed with 1013. */
export const MAX_BUFFERED_BYTES = 4 * 1024 * 1024
/** Bytes held past which a client counts as backpressured. */
export const BACKPRESSURE_BYTES = 1024 * 1024
export const PING_MS = 25_000
export const IDLE_MS = 60_000

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
 * { send(text|Buffer), close(), onmessage(data, isBinary), onclose(),
 *   ondrain(), bufferedAmount, backpressured }.
 * `options` are for tests and tuning: maxBuffered, backpressureBytes,
 * pingMs, idleMs, and the clock (now, setInterval, clearInterval).
 */
export function acceptWebSocket(
  req,
  socket,
  head,
  {
    maxBuffered = MAX_BUFFERED_BYTES,
    backpressureBytes = BACKPRESSURE_BYTES,
    pingMs = PING_MS,
    idleMs = IDLE_MS,
    now = Date.now,
    setInterval: every = setInterval,
    clearInterval: stopEvery = clearInterval,
  } = {}
) {
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
  let heard = now()
  let timer = null
  const closeFrame = (code) => {
    const body = Buffer.alloc(2)
    body.writeUInt16BE(code)
    return encodeFrame(8, body)
  }
  const finish = () => {
    closed = true
    if (timer) stopEvery(timer)
    timer = null
    ws.onclose()
  }
  // Too far behind, or gone quiet: no closing handshake to wait for
  const drop = (code) => {
    if (closed) return
    if (code) socket.end(closeFrame(code))
    socket.destroy()
    finish()
  }
  const ws = {
    onmessage: () => {},
    onclose: () => {},
    ondrain: () => {},
    /** Bytes sent but not yet taken by the network. */
    get bufferedAmount() {
      return socket.writableLength ?? 0
    },
    /** Behind enough that updates a newer one replaces are best skipped. */
    get backpressured() {
      return ws.bufferedAmount > backpressureBytes
    },
    send(data) {
      if (closed) return
      const bytes = Buffer.byteLength(data)
      if (bytes > MAX_MESSAGE_BYTES) return ws.close(1009)
      if (bytes + ws.bufferedAmount > maxBuffered) return drop(1013)
      socket.write(
        typeof data === 'string' ? encodeFrame(1, data) : encodeFrame(2, data)
      )
    },
    close(code = 1000) {
      if (closed) return
      socket.end(closeFrame(code))
      finish()
    },
  }
  const onData = (chunk) => {
    heard = now()
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
    if (!closed) finish()
  })
  socket.on('error', () => socket.destroy())
  socket.on('drain', () => {
    if (!closed) ws.ondrain()
  })
  // Checked each ping, so a dead socket goes within idleMs + pingMs
  timer = every(() => {
    if (closed) return
    if (now() - heard >= idleMs) return drop(1001)
    socket.write(encodeFrame(9, Buffer.alloc(0)))
  }, pingMs)
  timer?.unref?.()
  // Let the caller attach its callbacks before delivering upgrade-head data.
  if (buf.length)
    queueMicrotask(() => {
      if (!closed) onData(Buffer.alloc(0))
    })
  return ws
}
