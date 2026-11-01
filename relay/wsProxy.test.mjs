import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { acceptWebSocket } from './wsProxy.mjs'

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
function connection(head = Buffer.alloc(0), options = {}) {
  const socket = new EventEmitter()
  socket.writableLength = 0
  socket.written = []
  socket.write = (data) => {
    socket.written.push(data)
    return true
  }
  socket.setNoDelay = () => {}
  socket.end = (data) => {
    socket.ended = data
  }
  socket.destroy = () => {
    socket.destroyed = true
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
    head,
    options
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

// A clock and interval the test drives by hand
function fakeTimers() {
  const t = { ms: 0, fn: null, cleared: false }
  t.now = () => t.ms
  t.setInterval = (fn, ms) => {
    t.fn = fn
    t.every = ms
    return { unref() {} }
  }
  t.clearInterval = () => {
    t.cleared = true
  }
  t.tick = (ms) => {
    t.ms += ms
    t.fn()
  }
  return t
}
const opcodes = (socket) => socket.written.map((b) => b[0] & 0x0f)

test('a client that falls too far behind is closed with 1013', () => {
  const timers = fakeTimers()
  const { ws, socket } = connection(undefined, {
    maxBuffered: 1000,
    backpressureBytes: 400,
    ...timers,
  })
  let closed = 0
  ws.onclose = () => closed++
  ws.send('x'.repeat(300))
  assert.equal(ws.backpressured, false)
  socket.writableLength = 500
  assert.equal(ws.bufferedAmount, 500)
  assert.equal(ws.backpressured, true)
  // Still under the cap: sent
  ws.send('x'.repeat(400))
  assert.equal(socket.written.length, 3) // handshake and two messages
  // Over it: closed and dropped, nothing more queued
  ws.send('x'.repeat(600))
  assert.equal(socket.ended.readUInt16BE(2), 1013)
  assert.equal(socket.destroyed, true)
  assert.equal(closed, 1)
  assert.equal(timers.cleared, true)
  ws.send('more')
  assert.equal(socket.written.length, 3)
})

test('drain is passed on, so a caller can catch a client up', () => {
  const { ws, socket } = connection()
  let drained = 0
  ws.ondrain = () => drained++
  socket.emit('drain')
  assert.equal(drained, 1)
})

test('the server pings, and drops a socket it has not heard from', () => {
  const timers = fakeTimers()
  const { ws, socket } = connection(undefined, {
    pingMs: 25,
    idleMs: 60,
    ...timers,
  })
  let closed = 0
  ws.onclose = () => closed++
  assert.equal(timers.every, 25)
  timers.tick(25)
  assert.equal(opcodes(socket).at(-1), 9)
  // A pong counts as hearing from it
  timers.ms += 20
  socket.emit('data', frame(10, ''))
  timers.tick(25)
  timers.tick(25)
  assert.equal(closed, 0)
  assert.equal(opcodes(socket).filter((o) => o === 9).length, 3)
  // So does any other frame, like the apps' JSON ping
  ws.onmessage = () => {}
  socket.emit('data', frame(1, '{"t":"ping"}'))
  timers.tick(25)
  timers.tick(25)
  assert.equal(closed, 0)
  // Then silence
  timers.tick(25)
  assert.equal(closed, 1)
  assert.equal(socket.destroyed, true)
  assert.equal(timers.cleared, true)
  socket.emit('close')
  assert.equal(closed, 1)
})

test('timers stop when the socket closes', () => {
  const timers = fakeTimers()
  const { ws, socket } = connection(undefined, timers)
  ws.close()
  assert.equal(timers.cleared, true)
  const other = fakeTimers()
  const conn = connection(undefined, other)
  conn.socket.emit('close')
  assert.equal(other.cleared, true)
  assert.equal(socket.ended.readUInt16BE(2), 1000)
})

test('a client ping still gets a pong', () => {
  const { socket } = connection()
  socket.emit('data', frame(9, 'hi'))
  const pong = socket.written.at(-1)
  assert.equal(pong[0] & 0x0f, 10)
  assert.equal(pong.subarray(2).toString(), 'hi')
})
