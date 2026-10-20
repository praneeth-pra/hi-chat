import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanSnapshot, createMirrorHub } from './mirror.mjs'
import { createRelay } from './server.mjs'

function fakeSocket() {
  const ws = {
    got: [],
    send(data) {
      ws.got.push(JSON.parse(data))
    },
    onmessage: () => {},
    onclose: () => {},
  }
  return ws
}

const snap = (msgs, title = 'Plans') =>
  JSON.stringify({ t: 'snap', title, msgs })

test('viewers get the conversation and the reply as it streams', () => {
  const hub = createMirrorHub()
  const sender = fakeSocket()
  const viewer = fakeSocket()
  hub.join(sender, 'send')
  hub.join(viewer, 'view')
  assert.deepEqual(sender.got.at(-1), { t: 'viewers', n: 1 })
  assert.deepEqual(viewer.got.at(-1), { t: 'sender', on: true })

  sender.onmessage(snap([{ id: 'u1', role: 'user', text: 'Hi' }]))
  sender.onmessage(JSON.stringify({ t: 'stream', id: 'a1', text: 'Hel' }))
  sender.onmessage(JSON.stringify({ t: 'stream', id: 'a1', add: 'lo' }))
  assert.deepEqual(viewer.got.slice(-3), [
    {
      t: 'snap',
      title: 'Plans',
      msgs: [{ id: 'u1', role: 'user', text: 'Hi' }],
    },
    { t: 'stream', id: 'a1', text: 'Hel' },
    { t: 'stream', id: 'a1', add: 'lo' },
  ])

  // A viewer joining mid-reply starts from all of it
  const late = fakeSocket()
  hub.join(late, 'view')
  assert.deepEqual(late.got.slice(0, 2), [
    {
      t: 'snap',
      title: 'Plans',
      msgs: [{ id: 'u1', role: 'user', text: 'Hi' }],
    },
    { t: 'stream', id: 'a1', text: 'Hello' },
  ])
  assert.deepEqual(sender.got.at(-1), { t: 'viewers', n: 2 })

  // The finished reply ends the stream
  sender.onmessage(
    snap([
      { id: 'u1', role: 'user', text: 'Hi' },
      { id: 'a1', role: 'assistant', text: 'Hello' },
    ])
  )
  const again = fakeSocket()
  hub.join(again, 'view')
  assert.equal(
    again.got.filter((m) => m.t === 'stream').length,
    0,
    'no stale stream'
  )

  viewer.onclose()
  late.onclose()
  again.onclose()
  assert.deepEqual(sender.got.at(-1), { t: 'viewers', n: 0 })
  sender.onclose()
  assert.deepEqual(hub.counts, { senders: 0, viewers: 0 })
})

test('a reply saved under a new id still ends the stream', () => {
  const hub = createMirrorHub()
  const sender = fakeSocket()
  hub.join(sender, 'send')
  hub.join(fakeSocket(), 'view')
  sender.onmessage(snap([{ id: 'u1', role: 'user', text: 'Hi' }]))
  sender.onmessage(JSON.stringify({ t: 'stream', id: 's1', text: 'Hel' }))
  // The chat saves the finished reply with an id the stream never had
  sender.onmessage(
    snap([
      { id: 'u1', role: 'user', text: 'Hi' },
      { id: 'a7', role: 'assistant', text: 'Hello' },
    ])
  )
  const late = fakeSocket()
  hub.join(late, 'view')
  assert.equal(late.got.filter((m) => m.t === 'stream').length, 0)
})

test('viewers cannot send, and bad messages are dropped', () => {
  const hub = createMirrorHub()
  const sender = fakeSocket()
  const viewer = fakeSocket()
  const other = fakeSocket()
  hub.join(sender, 'send')
  hub.join(viewer, 'view')
  hub.join(other, 'view')
  const before = other.got.length
  viewer.onmessage(snap([{ id: 'x', role: 'user', text: 'spoof' }]))
  sender.onmessage('not json')
  sender.onmessage(JSON.stringify({ t: 'snap', msgs: 'nope' }))
  sender.onmessage(JSON.stringify({ t: 'stream', id: 5, text: 'x' }))
  // An append to a reply that isn't streaming
  sender.onmessage(JSON.stringify({ t: 'stream', id: 'a9', add: 'x' }))
  assert.equal(other.got.length, before)
})

test('snapshots keep known fields and stay under the size cap', () => {
  const big = 'x'.repeat(500_000)
  const clean = cleanSnapshot({
    title: 5,
    msgs: [
      { id: 'a', role: 'user', text: big, extra: 1 },
      { id: 'b', role: 'system', text: big },
      { id: 'c', role: 'assistant', text: 'last' },
    ],
  })
  assert.equal(clean.title, '')
  assert.deepEqual(Object.keys(clean.msgs[0]).sort(), ['id', 'role', 'text'])
  assert.equal(clean.msgs.at(-1).text, 'last')
  assert.equal(clean.msgs.at(-2).role, 'assistant')
  const total = clean.msgs.reduce((n, m) => n + m.text.length, 0)
  assert.ok(total <= 900_000, `total ${total}`)
  assert.equal(cleanSnapshot({ msgs: null }), null)
})

test('the relay serves /api/mirror over real WebSockets', async () => {
  const server = createRelay({ env: {} })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `ws://127.0.0.1:${server.address().port}/api/mirror`
  const open = (role) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base}?role=${role}`)
      const got = []
      const waiters = []
      ws.onmessage = (e) => {
        got.push(JSON.parse(e.data))
        waiters.splice(0).forEach((w) => w())
      }
      ws.onopen = () => resolve({ ws, got, waiters })
      ws.onerror = reject
    })
  const until = (c, pred) =>
    new Promise((resolve) => {
      const check = () => (pred(c.got) ? resolve() : c.waiters.push(check))
      check()
    })
  try {
    const sender = await open('send')
    const viewer = await open('view')
    await until(sender, (g) => g.some((m) => m.t === 'viewers' && m.n === 1))
    sender.ws.send(snap([{ id: 'u1', role: 'user', text: 'Hi' }]))
    sender.ws.send(JSON.stringify({ t: 'stream', id: 'a1', text: 'Hey' }))
    await until(viewer, (g) => g.some((m) => m.t === 'stream'))
    assert.deepEqual(
      viewer.got.filter((m) => m.t !== 'sender'),
      [
        {
          t: 'snap',
          title: 'Plans',
          msgs: [{ id: 'u1', role: 'user', text: 'Hi' }],
        },
        { t: 'stream', id: 'a1', text: 'Hey' },
      ]
    )
    viewer.ws.close()
    await until(sender, (g) => g.at(-1)?.t === 'viewers' && g.at(-1).n === 0)
    sender.ws.close()
  } finally {
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
  }
})
