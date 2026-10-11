import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { acceptWebSocket, grokLive } from './wsProxy.mjs'

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
