import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  acceptWebSocket,
  grokLive,
  pcmToWav,
  sarvamLive,
  SARVAM_LIVE_URL,
} from './wsProxy.mjs'

function frame(opcode, data, fin = true, masked = true) {
  const body = Buffer.from(data)
  let head
  if (body.length < 126)
    head = Buffer.from([
      (fin ? 128 : 0) | opcode,
      (masked ? 128 : 0) | body.length,
    ])
  else {
    head = Buffer.alloc(4)
    head[0] = (fin ? 128 : 0) | opcode
    head[1] = (masked ? 128 : 0) | 126
    head.writeUInt16BE(body.length, 2)
  }
  return Buffer.concat(masked ? [head, Buffer.alloc(4), body] : [head, body])
}
function connection(head = Buffer.alloc(0)) {
  const socket = new EventEmitter()
  socket.writableLength = 0
  socket.write = () => {}
  socket.setNoDelay = () => {}
  socket.end = (data) => {
    socket.ended = data
  }
  const ws = acceptWebSocket(
    {
      headers: {
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'sec-websocket-version': '13',
        'upgrade': 'websocket',
      },
    },
    socket,
    head
  )
  return { ws, socket }
}
test('upgrade-head messages arrive after callbacks are attached', async () => {
  const { ws } = connection(frame(1, 'hello'))
  let text
  ws.onmessage = (data) => {
    text = data
  }
  await Promise.resolve()
  assert.equal(text, 'hello')
})
test('valid fragments combine once; illegal frames close without delivery', () => {
  const { ws, socket } = connection()
  const messages = []
  ws.onmessage = (data) => messages.push(data)
  socket.emit('data', frame(1, 'hel', false))
  socket.emit('data', frame(0, 'lo'))
  assert.deepEqual(messages, ['hello'])
  for (const input of [
    frame(0, 'orphan'),
    frame(1, 'unmasked', true, false),
    frame(9, 'ping', false),
  ]) {
    const conn = connection()
    conn.ws.onmessage = () => assert.fail('invalid frame delivered')
    conn.socket.emit('data', input)
    assert.equal(conn.socket.ended.readUInt16BE(2), 1002)
  }
})
test('aggregate fragmented messages have a bounded size', () => {
  const { socket } = connection()
  socket.emit('data', frame(2, Buffer.alloc(65535), false))
  for (let i = 0; i < 17 && !socket.ended; i++)
    socket.emit('data', frame(0, Buffer.alloc(65535), false))
  assert.equal(socket.ended.readUInt16BE(2), 1009)
})
test('queued audio cannot grow without bound while upstream is not ready', () => {
  let closed = 0
  const client = {
    send() {},
    close() {
      closed++
    },
  }
  class Upstream {
    close() {}
  }
  grokLive(client, {
    env: { XAI_API_KEY: 'x' },
    WebSocketImpl: Upstream,
    log() {},
  })
  client.onmessage(Buffer.alloc(1024 * 1024))
  client.onmessage(Buffer.alloc(1))
  assert.equal(closed, 1)
})

test('upstream readiness timeout closes the browser and releases held audio', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let clientClosed = 0
  let upstreamClosed = 0
  const client = { send() {}, close() { clientClosed++ } }
  class Upstream { close() { upstreamClosed++ } }
  grokLive(client, { env: { XAI_API_KEY: 'x' }, WebSocketImpl: Upstream, log() {} })
  client.onmessage(Buffer.alloc(100))
  t.mock.timers.tick(10_000)
  assert.equal(clientClosed, 1)
  assert.equal(upstreamClosed, 1)
  client.onmessage(Buffer.alloc(100))
  assert.equal(clientClosed, 1)
})

test('Sarvam live: key in a header, Indian English, audio as WAV JSON, flush passed on', () => {
  const toClient = []
  const client = { send: (m) => toClient.push(m), close() {} }
  let up
  class Upstream {
    constructor(url, opts) {
      up = this
      this.url = url
      this.opts = opts
      this.sent = []
      this.readyState = 1
      this.bufferedAmount = 0
    }
    send(m) {
      this.sent.push(m)
    }
    close() {}
  }
  sarvamLive(client, {
    env: { SARVAM_API_KEY: 'sk-sarvam' },
    WebSocketImpl: Upstream,
    log() {},
    keyterms: ['Koramangala', 'x'.repeat(70)],
  })
  const url = new URL(up.url)
  assert.equal(`${url.origin}${url.pathname}`, SARVAM_LIVE_URL)
  assert.equal(url.searchParams.get('language-code'), 'en-IN')
  assert.equal(url.searchParams.get('model'), 'saaras:v4')
  assert.equal(url.searchParams.get('flush_signal'), 'true')
  // Over-long terms are dropped (Sarvam allows 64 characters)
  assert.deepEqual(JSON.parse(url.searchParams.get('keyterms')), ['Koramangala'])
  assert.deepEqual(up.opts.headers, { 'Api-Subscription-Key': 'sk-sarvam' })
  assert.ok(!up.url.includes('sk-sarvam'))
  // Audio before the socket opens is held, then sent as a WAV in JSON
  const pcm = Buffer.alloc(3200, 1)
  client.onmessage(pcm)
  assert.equal(up.sent.length, 0)
  up.onopen()
  assert.deepEqual(JSON.parse(toClient[0]), { type: 'ready' })
  const audio = JSON.parse(up.sent[0]).audio
  assert.equal(audio.encoding, 'audio/wav')
  assert.equal(audio.sample_rate, 16000)
  assert.deepEqual(
    Buffer.from(audio.data, 'base64'),
    pcmToWav(pcm)
  )
  // The browser's flush goes through as it is
  client.onmessage(JSON.stringify({ type: 'flush' }))
  assert.equal(up.sent.at(-1), '{"type":"flush"}')
  // Sarvam's replies come back unchanged
  up.onmessage({ data: '{"type":"data","data":{"transcript":"Hi"}}' })
  assert.equal(toClient.at(-1), '{"type":"data","data":{"transcript":"Hi"}}')
})

test('Sarvam live without a key tells the browser and closes', () => {
  const toClient = []
  let closed
  const client = { send: (m) => toClient.push(m), close: (c) => (closed = c) }
  sarvamLive(client, { env: {}, WebSocketImpl: class {}, log() {} })
  assert.match(toClient[0], /SARVAM_API_KEY not set/)
  assert.equal(closed, 1011)
})

test('a WAV header describes 16 kHz mono 16-bit audio', () => {
  const wav = pcmToWav(Buffer.alloc(100))
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.equal(wav.readUInt32LE(24), 16000)
  assert.equal(wav.readUInt16LE(22), 1)
  assert.equal(wav.readUInt16LE(34), 16)
  assert.equal(wav.readUInt32LE(40), 100)
  assert.equal(wav.length, 144)
})
