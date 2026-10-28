import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanSnapshot, createMirrorHub, LINK_TTL_MS } from './mirror.mjs'
import { createRelay } from './server.mjs'

// The last message of type `t` a socket got (others, like 'peer', may follow)
const lastOf = (ws, t) => ws.got.filter((m) => m.t === t).at(-1)

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

// A link's viewer typing the code, and its app letting it in
function letIn(app, viewer) {
  viewer.onmessage(JSON.stringify({ t: 'code', code: '4821' }))
  const knock = app.got.filter((m) => m.t === 'knock').at(-1)
  app.onmessage(JSON.stringify({ t: 'admit', to: knock.from }))
}

const snap = (msgs, title = 'Plans') =>
  JSON.stringify({ t: 'snap', title, msgs })

test('viewers get the conversation and the reply as it streams', () => {
  const hub = createMirrorHub()
  const sender = fakeSocket()
  const viewer = fakeSocket()
  hub.join(sender, 'send')
  hub.join(viewer, 'view')
  assert.deepEqual(lastOf(sender, 'viewers'), { t: 'viewers', n: 1 })
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
  assert.deepEqual(lastOf(sender, 'viewers'), { t: 'viewers', n: 2 })

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
  assert.deepEqual(lastOf(sender, 'viewers'), { t: 'viewers', n: 0 })
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

test('scroll positions keep their exact px, cleaned', () => {
  const hub = createMirrorHub()
  const sender = fakeSocket()
  const viewer = fakeSocket()
  hub.join(sender, 'send')
  hub.join(viewer, 'view')
  sender.onmessage(
    JSON.stringify({ t: 'scroll', id: 'a1', f: 0.2, px: 120.4, h: 600 })
  )
  assert.deepEqual(lastOf(viewer, 'scroll'), {
    t: 'scroll',
    id: 'a1',
    f: 0.2,
    px: 120,
    h: 600,
  })
  sender.onmessage(
    JSON.stringify({ t: 'scroll', id: 'a1', f: 0.3, px: 'x', h: -1 })
  )
  assert.deepEqual(lastOf(viewer, 'scroll'), { t: 'scroll', id: 'a1', f: 0.3 })
})

test('viewers hear how much of the reply Hi-chat shows', () => {
  const hub = createMirrorHub()
  const sender = fakeSocket()
  const viewer = fakeSocket()
  hub.join(sender, 'send')
  hub.join(viewer, 'view')
  sender.onmessage(
    JSON.stringify({ t: 'shown', id: 'a1', n: 42, s: 'abcdefgh12', q: 7 })
  )
  assert.deepEqual(lastOf(viewer, 'shown'), {
    t: 'shown',
    id: 'a1',
    n: 42,
    s: 'abcdefgh12',
    q: 7,
  })
  // Nonsense is dropped
  sender.onmessage(JSON.stringify({ t: 'shown', id: 'a1', n: 'lots' }))
  sender.onmessage(JSON.stringify({ t: 'shown', n: 5 }))
  assert.equal(viewer.got.filter((m) => m.t === 'shown').length, 1)
})

test('viewers scroll with Hi-chat, late ones too', () => {
  const hub = createMirrorHub()
  const sender = fakeSocket()
  const viewer = fakeSocket()
  hub.join(sender, 'send')
  hub.join(viewer, 'view')
  sender.onmessage(JSON.stringify({ t: 'scroll', id: 'm1', f: 1.7, x: 1 }))
  assert.deepEqual(viewer.got.at(-1), { t: 'scroll', id: 'm1', f: 1 })
  sender.onmessage(JSON.stringify({ t: 'scroll', id: 'm1', f: 'x' }))
  assert.deepEqual(viewer.got.at(-1), { t: 'scroll', id: 'm1', f: 1 })
  sender.onmessage(JSON.stringify({ t: 'scroll', bottom: true }))
  assert.deepEqual(viewer.got.at(-1), { t: 'scroll', bottom: true })
  const late = fakeSocket()
  hub.join(late, 'view')
  assert.deepEqual(
    late.got.filter((m) => m.t === 'scroll'),
    [{ t: 'scroll', bottom: true }]
  )
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
  const base = `ws://127.0.0.1:${server.address().port}/api`
  const link = 'L'.repeat(24)
  const open = (path) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base}/${path}`)
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
    const sender = await open(
      `mirror?role=send&link=${link}&born=${Date.now()}`
    )
    // Watching is only through a link: the signed-in /mirror is gone
    await assert.rejects(open('mirror?role=view'))
    const viewer = await open(`mirror-link?link=${link}`)
    // Let in with the code Hi-chat checks
    await until(viewer, (g) => g.some((m) => m.t === 'gate'))
    viewer.ws.send(JSON.stringify({ t: 'code', code: '4821' }))
    await until(sender, (g) => g.some((m) => m.t === 'knock'))
    const knock = sender.got.find((m) => m.t === 'knock')
    assert.equal(knock.code, '4821')
    sender.ws.send(JSON.stringify({ t: 'admit', to: knock.from }))
    await until(sender, (g) => g.some((m) => m.t === 'viewers' && m.n === 1))
    sender.ws.send(snap([{ id: 'u1', role: 'user', text: 'Hi' }]))
    sender.ws.send(JSON.stringify({ t: 'stream', id: 'a1', text: 'Hey' }))
    await until(viewer, (g) => g.some((m) => m.t === 'stream'))
    assert.deepEqual(
      viewer.got.filter((m) => !['sender', 'gate', 'admitted'].includes(m.t)),
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

test('a link shows only its own app, and stops when the app replaces it', () => {
  let t = 1000
  const hub = createMirrorHub({ now: () => t })
  const link = 'L'.repeat(22)
  const other = 'O'.repeat(22)
  const appA = fakeSocket()
  const appB = fakeSocket()
  assert.equal(hub.isLink(link), false, 'unknown until an app opens it')
  hub.join(appA, 'send', { link })
  hub.join(appB, 'send', { link: other })
  assert.equal(hub.isLink(link), true)

  const viaLink = fakeSocket()
  const signedIn = fakeSocket()
  viaLink.closed = null
  viaLink.close = (code) => {
    viaLink.closed = code
    viaLink.onclose()
  }
  hub.join(viaLink, 'view', { link })
  letIn(appA, viaLink)
  hub.join(signedIn, 'view')
  assert.deepEqual(viaLink.got.at(-1), { t: 'sender', on: true })

  appA.onmessage(snap([{ id: 'a', role: 'user', text: 'from A' }]))
  appB.onmessage(snap([{ id: 'b', role: 'user', text: 'from B' }]))
  // The link sees only app A; the signed-in mirror sees both, latest last
  assert.deepEqual(
    viaLink.got.filter((m) => m.t === 'snap').map((m) => m.msgs[0].text),
    ['from A']
  )
  assert.equal(
    signedIn.got.filter((m) => m.t === 'snap').at(-1).msgs[0].text,
    'from B'
  )
  // App A hears both viewers, B only the signed-in one
  assert.deepEqual(lastOf(appA, 'viewers'), { t: 'viewers', n: 2 })
  assert.deepEqual(lastOf(appB, 'viewers'), { t: 'viewers', n: 1 })

  // Closing the app keeps the link for a while, so a restart keeps it
  appA.onclose()
  assert.equal(hub.isLink(link), true)
  t += 13 * 60 * 60 * 1000
  assert.equal(hub.isLink(link), false, 'gone after the grace period')

  // "New link": the old one stops at once and its viewers are closed
  const fresh = 'P'.repeat(22)
  const appC = fakeSocket()
  hub.join(appC, 'send', { link: fresh })
  const viaFresh = closable()
  hub.join(viaFresh, 'view', { link: fresh })
  appC.onmessage(JSON.stringify({ t: 'revoke', link: fresh }))
  assert.equal(hub.isLink(fresh), false)
  assert.equal(viaFresh.closed, 4001)
  // and an app still holding it can't open it again
  hub.join(fakeSocket(), 'send', { link: fresh })
  assert.equal(hub.isLink(fresh), false)
})

const closable = () => {
  const ws = fakeSocket()
  ws.closed = null
  ws.close = (code) => {
    ws.closed = code
    ws.onclose()
  }
  return ws
}

test('a link ends for good 90 minutes after its app made it', () => {
  let t = 10_000_000
  const ended = []
  const hub = createMirrorHub({
    now: () => t,
    onLinkEnded: (s) => ended.push(s),
  })
  const link = 'L'.repeat(24)
  const app = fakeSocket()
  hub.join(app, 'send', { link, born: String(t) })
  const viewer = closable()
  hub.join(viewer, 'view', { link })
  app.onmessage(snap([{ id: 'a', role: 'user', text: 'secret' }]))

  t += LINK_TTL_MS - 1
  hub.sweep()
  assert.equal(hub.isLink(link), true, 'still good just before')
  assert.equal(viewer.closed, null)

  t += 1
  hub.sweep()
  assert.equal(viewer.closed, 4001, 'its viewer is closed at 90 minutes')
  assert.equal(hub.isLink(link), false)
  assert.deepEqual(ended, [link])
  // The app reconnecting with it (or another window) doesn't revive it
  app.onclose()
  const again = fakeSocket()
  hub.join(again, 'send', { link, born: String(t) })
  assert.equal(hub.isLink(link), false)
  // and the app goes on sending to the signed-in /mirror
  const signedIn = fakeSocket()
  hub.join(signedIn, 'view')
  again.onmessage(snap([{ id: 'b', role: 'user', text: 'still here' }]))
  assert.equal(lastOf(signedIn, 'snap').msgs[0].text, 'still here')
})

test("a link's 90 minutes count from when the app made it, not a restart", () => {
  let t = 10_000_000
  const hub = createMirrorHub({ now: () => t })
  const link = 'L'.repeat(24)
  // This server just started, but the app made its link 89 minutes ago
  const app = fakeSocket()
  hub.join(app, 'send', { link, born: String(t - 89 * 60_000) })
  assert.equal(hub.isLink(link), true)
  t += 60_000
  assert.equal(hub.isLink(link), false)

  // Made over 90 minutes ago: never opens at all
  const old = 'O'.repeat(24)
  hub.join(fakeSocket(), 'send', { link: old, born: String(t - LINK_TTL_MS) })
  assert.equal(hub.isLink(old), false)

  // A time in the future counts as now; nonsense counts as now
  const ahead = 'A'.repeat(24)
  hub.join(fakeSocket(), 'send', { link: ahead, born: String(t + 1e9) })
  const junk = 'J'.repeat(24)
  hub.join(fakeSocket(), 'send', { link: junk, born: 'soon' })
  t += LINK_TTL_MS - 1
  assert.equal(hub.isLink(ahead), true)
  assert.equal(hub.isLink(junk), true)
  t += 1
  assert.equal(hub.isLink(ahead), false)
  assert.equal(hub.isLink(junk), false)

  // A second window can't stretch it with a later time
  const shared = 'S'.repeat(24)
  hub.join(fakeSocket(), 'send', { link: shared, born: String(t) })
  t += 60 * 60_000
  hub.join(fakeSocket(), 'send', { link: shared, born: String(t) })
  t += 30 * 60_000
  assert.equal(hub.isLink(shared), false)
})

test('links must look like secrets', () => {
  const hub = createMirrorHub()
  const app = fakeSocket()
  hub.join(app, 'send', { link: 'short' })
  assert.equal(hub.isLink('short'), false)
  assert.equal(hub.isLink(''), false)
  assert.equal(hub.isLink(undefined), false)
})

test('only what changed goes out, and late viewers still get it all', () => {
  const hub = createMirrorHub()
  const app = fakeSocket()
  const viewer = fakeSocket()
  hub.join(app, 'send')
  hub.join(viewer, 'view')
  app.onmessage(snap([{ id: 'u1', role: 'user', text: 'Hi' }]))
  app.onmessage(JSON.stringify({ t: 'stream', id: 's', text: 'Hel' }))
  app.onmessage(
    JSON.stringify({
      t: 'ops',
      title: 'Plans',
      set: [],
      add: [{ id: 'a1', role: 'assistant', text: 'Hello', junk: 1 }],
    })
  )
  // The viewer hears just the addition, cleaned
  assert.deepEqual(viewer.got.at(-1), {
    t: 'ops',
    title: 'Plans',
    set: [],
    add: [{ id: 'a1', role: 'assistant', text: 'Hello' }],
  })
  // A set of a message the hub doesn't have is dropped (the app sends a snap)
  const seen = viewer.got.length
  app.onmessage(
    JSON.stringify({ t: 'ops', set: [{ id: 'nope', role: 'user', text: 'x' }] })
  )
  assert.equal(viewer.got.length, seen)
  // A viewer joining now gets the whole conversation, and no ended stream
  const late = fakeSocket()
  hub.join(late, 'view')
  const lateSnap = late.got.find((m) => m.t === 'snap')
  assert.deepEqual(
    lateSnap.msgs.map((m) => m.text),
    ['Hi', 'Hello']
  )
  assert.equal(
    late.got.some((m) => m.t === 'stream'),
    false
  )
})

test('messages keep what Hi-chat shows, and nothing else', () => {
  const clean = cleanSnapshot({
    msgs: [
      {
        id: 'a',
        role: 'assistant',
        text: 'x',
        stopped: true,
        files: ['notes.pdf', 5],
        images: ['a.0', 'bad key!'],
        review: {
          verdict: 'approved',
          verifier: 'v',
          sources: [
            { title: 'Docs', url: 'https://example.com' },
            { title: 'Bad', url: 'javascript:alert(1)' },
          ],
          secret: 'no',
        },
        tools: [{ name: 'search', pending: true, args: 'no' }],
      },
    ],
  })
  assert.deepEqual(clean.msgs[0], {
    id: 'a',
    role: 'assistant',
    text: 'x',
    files: ['notes.pdf'],
    images: ['a.0'],
    stopped: true,
    review: {
      verdict: 'approved',
      fallback: undefined,
      verifier: 'v',
      webStatus: undefined,
      sources: [{ title: 'Docs', url: 'https://example.com' }],
    },
    tools: [{ name: 'search', pending: true }],
  })
})

test('screenshots and Accuracy progress reach viewers, late ones too', () => {
  const hub = createMirrorHub()
  const app = fakeSocket()
  const viewer = fakeSocket()
  hub.join(app, 'send')
  hub.join(viewer, 'view')
  const src = 'data:image/jpeg;base64,AAAA'
  app.onmessage(JSON.stringify({ t: 'img', key: 'u1.0', src }))
  app.onmessage(JSON.stringify({ t: 'img', key: 'u1.1', src: 'javascript:x' }))
  app.onmessage(JSON.stringify({ t: 'phase', phase: 'drafting' }))
  assert.deepEqual(
    viewer.got.filter((m) => m.t === 'img'),
    [{ t: 'img', key: 'u1.0', src }]
  )
  assert.deepEqual(viewer.got.at(-1), { t: 'phase', phase: 'drafting' })
  const late = fakeSocket()
  hub.join(late, 'view')
  assert.ok(late.got.some((m) => m.t === 'img' && m.key === 'u1.0'))
  assert.ok(late.got.some((m) => m.t === 'phase' && m.phase === 'drafting'))
  app.onmessage(JSON.stringify({ t: 'phase', phase: 'bogus' }))
  assert.deepEqual(viewer.got.at(-1), { t: 'phase', phase: null })
})

test('pings get a pong that echoes their time', () => {
  const hub = createMirrorHub()
  const app = fakeSocket()
  const viewer = fakeSocket()
  hub.join(app, 'send')
  hub.join(viewer, 'view')
  viewer.onmessage(JSON.stringify({ t: 'ping', n: 123.5 }))
  assert.deepEqual(viewer.got.at(-1), { t: 'pong', n: 123.5 })
  app.onmessage('{"t":"ping"}')
  assert.deepEqual(app.got.at(-1), { t: 'pong' })
})

test('direct connections: the hub introduces each viewer and passes setup', () => {
  const hub = createMirrorHub()
  const viewer = fakeSocket()
  hub.join(viewer, 'view')
  const app = fakeSocket()
  hub.join(app, 'send')
  // The app hears of the viewer already watching, with STUN to use
  const note = lastOf(app, 'peer')
  assert.equal(note.on, true)
  assert.match(note.id, /^[0-9a-f]{16}$/)
  assert.match(JSON.stringify(note.ice), /stun:/)

  // Its offer reaches that viewer (with the ICE list), from the app's id
  app.onmessage(
    JSON.stringify({ t: 'rtc', to: note.id, type: 'offer', sdp: 'v=0 o', x: 1 })
  )
  const offer = lastOf(viewer, 'rtc')
  assert.equal(offer.type, 'offer')
  assert.equal(offer.sdp, 'v=0 o')
  assert.equal(offer.x, undefined)
  assert.ok(Array.isArray(offer.ice))
  assert.match(offer.from, /^[0-9a-f]{16}$/)

  // The viewer's answer and candidates reach the app, from the viewer's id
  viewer.onmessage(
    JSON.stringify({ t: 'rtc', to: offer.from, type: 'answer', sdp: 'v=0 a' })
  )
  assert.deepEqual(lastOf(app, 'rtc'), {
    t: 'rtc',
    from: note.id,
    type: 'answer',
    sdp: 'v=0 a',
  })
  viewer.onmessage(
    JSON.stringify({
      t: 'rtc',
      to: offer.from,
      candidate: {
        candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    })
  )
  assert.equal(lastOf(app, 'rtc').candidate.sdpMid, '0')

  // Nothing passes to an id that isn't there, or isn't the other side
  const seen = app.got.length
  viewer.onmessage(
    JSON.stringify({ t: 'rtc', to: note.id, type: 'answer', sdp: 'x' })
  )
  viewer.onmessage(
    JSON.stringify({
      t: 'rtc',
      to: '0000000000000000',
      type: 'answer',
      sdp: 'x',
    })
  )
  viewer.onmessage(
    JSON.stringify({ t: 'rtc', to: offer.from, type: 'bogus', sdp: 'x' })
  )
  assert.equal(app.got.length, seen)

  // A new viewer is announced; one leaving too
  const second = fakeSocket()
  hub.join(second, 'view')
  const joined = lastOf(app, 'peer')
  assert.equal(joined.on, true)
  assert.notEqual(joined.id, note.id)
  second.onclose()
  assert.deepEqual(lastOf(app, 'peer'), { t: 'peer', id: joined.id, on: false })
})

test('direct connections: updates keep their sender and sequence number', () => {
  const hub = createMirrorHub()
  const viewer = fakeSocket()
  hub.join(viewer, 'view')
  const app = fakeSocket()
  hub.join(app, 'send')
  app.onmessage(
    JSON.stringify({ t: 'stream', id: 'r1', text: 'Hel', s: 'tab-1', q: 7 })
  )
  assert.deepEqual(lastOf(viewer, 'stream'), {
    t: 'stream',
    s: 'tab-1',
    q: 7,
    id: 'r1',
    text: 'Hel',
  })
  app.onmessage(JSON.stringify({ t: 'scroll', bottom: true, s: 'tab-1', q: 8 }))
  assert.deepEqual(lastOf(viewer, 'scroll'), {
    t: 'scroll',
    s: 'tab-1',
    q: 8,
    bottom: true,
  })
  // A late viewer starts from the latest, untagged
  const late = fakeSocket()
  hub.join(late, 'view')
  assert.deepEqual(lastOf(late, 'scroll'), { t: 'scroll', bottom: true })
  assert.deepEqual(lastOf(late, 'stream'), {
    t: 'stream',
    id: 'r1',
    text: 'Hel',
  })
  // A bad tag is dropped, the update still passes
  app.onmessage(
    JSON.stringify({ t: 'phase', phase: 'drafting', s: 'a"b', q: 9 })
  )
  assert.deepEqual(lastOf(viewer, 'phase'), { t: 'phase', phase: 'drafting' })
})

test("a link's viewer is marked, and only introduced once let in", () => {
  const hub = createMirrorHub()
  const app = fakeSocket()
  hub.join(app, 'send', { link: 'L'.repeat(24) })
  const signedIn = fakeSocket()
  hub.join(signedIn, 'view')
  assert.equal(lastOf(app, 'peer').link, undefined)
  const viaLink = fakeSocket()
  hub.join(viaLink, 'view', { link: 'L'.repeat(24) })
  assert.equal(app.got.filter((m) => m.t === 'peer').length, 1)
  letIn(app, viaLink)
  assert.equal(lastOf(app, 'peer').link, true)
})

test("viewers get Hi-chat's look and message box, late ones too", () => {
  const hub = createMirrorHub()
  const sender = fakeSocket()
  const viewer = fakeSocket()
  hub.join(sender, 'send')
  hub.join(viewer, 'view')
  sender.onmessage(
    JSON.stringify({
      t: 'look',
      width: 768.4,
      dark: true,
      vars: {
        '--font-size-base': '16px',
        '--app-main-view': 'rgba(23, 23, 23, 1)',
        // Nothing that loads anything, or breaks out of the value
        '--bad': 'url(https://evil.example/x.png)',
        '--worse': 'red; } body { display: none',
        'not-a-var': 'red',
      },
    })
  )
  assert.deepEqual(lastOf(viewer, 'look'), {
    t: 'look',
    width: 768,
    dark: true,
    vars: {
      '--font-size-base': '16px',
      '--app-main-view': 'rgba(23, 23, 23, 1)',
    },
  })
  sender.onmessage(JSON.stringify({ t: 'typing', text: 'What is' }))
  assert.deepEqual(lastOf(viewer, 'typing'), { t: 'typing', text: 'What is' })

  const late = fakeSocket()
  hub.join(late, 'view')
  assert.equal(lastOf(late, 'look')?.width, 768)
  assert.deepEqual(lastOf(late, 'typing'), { t: 'typing', text: 'What is' })
  // An emptied box isn't replayed to the next viewer
  sender.onmessage(JSON.stringify({ t: 'typing', text: '' }))
  const later = fakeSocket()
  hub.join(later, 'view')
  assert.equal(lastOf(later, 'typing'), undefined)
})

test('answers keep how long the model thought', () => {
  const clean = cleanSnapshot({
    msgs: [{ id: 'a', role: 'assistant', text: 'Hi', thinking: 2.4 }],
  })
  assert.equal(clean.msgs[0].thinking, 2.4)
  const bad = cleanSnapshot({
    msgs: [{ id: 'a', role: 'assistant', text: 'Hi', thinking: 'x' }],
  })
  assert.equal(bad.msgs[0].thinking, undefined)
})

test("a link's viewer sees nothing until Hi-chat lets it in with the code", () => {
  const hub = createMirrorHub()
  const link = 'L'.repeat(24)
  const app = fakeSocket()
  const other = fakeSocket() // another app, on its own link
  hub.join(app, 'send', { link })
  hub.join(other, 'send', { link: 'O'.repeat(24) })
  app.onmessage(snap([{ id: 'a', role: 'user', text: 'private' }]))

  const viewer = fakeSocket()
  hub.join(viewer, 'view', { link })
  assert.deepEqual(
    viewer.got.map((m) => m.t),
    ['gate', 'sender'],
    'only the door and whether Hi-chat is on'
  )
  app.onmessage(snap([{ id: 'b', role: 'user', text: 'still private' }]))
  assert.equal(viewer.got.filter((m) => m.t === 'snap').length, 0)
  assert.deepEqual(lastOf(app, 'viewers'), { t: 'viewers', n: 0 })

  // Asking for a code, then a wrong one: Hi-chat says so
  viewer.onmessage(JSON.stringify({ t: 'unlock' }))
  const ask = lastOf(app, 'knock')
  assert.equal(ask.ask, true)
  viewer.onmessage(JSON.stringify({ t: 'code', code: 'abcd' })) // not a code
  assert.equal(lastOf(app, 'knock'), ask)
  viewer.onmessage(JSON.stringify({ t: 'code', code: '1111' }))
  assert.equal(lastOf(app, 'knock').code, '1111')
  app.onmessage(JSON.stringify({ t: 'gate', to: ask.from, left: 4 }))
  assert.deepEqual(lastOf(viewer, 'code'), { t: 'code', ok: false, left: 4 })

  // Another app can't let it in
  other.onmessage(JSON.stringify({ t: 'admit', to: ask.from }))
  assert.equal(viewer.got.filter((m) => m.t === 'snap').length, 0)

  // The right code: in, with everything so far and a ticket
  app.onmessage(JSON.stringify({ t: 'admit', to: ask.from }))
  const { ticket } = lastOf(viewer, 'admitted')
  assert.match(ticket, /^[A-Za-z0-9_-]{24}$/)
  assert.equal(lastOf(viewer, 'snap').msgs[0].text, 'still private')
  assert.equal(lastOf(app, 'peer').link, true)
  assert.equal(hub.ticketOk(link, ticket), true)
  assert.equal(hub.ticketOk(link, 'x'.repeat(24)), false)
  assert.equal(hub.ticketOk('O'.repeat(24), ticket), false)

  // Its ticket lets it back in after a dropped connection, no code
  viewer.onclose()
  const back = closable()
  hub.join(back, 'view', { link, ticket })
  assert.equal(back.got[0].t, 'admitted')
  assert.equal(lastOf(back, 'snap').msgs[0].text, 'still private')
  // and a made-up one doesn't
  const guess = fakeSocket()
  hub.join(guess, 'view', { link, ticket: 'x'.repeat(24) })
  assert.equal(guess.got[0].t, 'gate')

  // Leaving the door: Hi-chat hides the code
  guess.onmessage(JSON.stringify({ t: 'unlock' }))
  const from = lastOf(app, 'knock').from
  guess.onclose()
  assert.deepEqual(lastOf(app, 'knock'), { t: 'knock', from, gone: true })

  // The link ending ends its tickets
  app.onmessage(JSON.stringify({ t: 'revoke', link }))
  assert.equal(hub.ticketOk(link, ticket), false)
})

test("a link's door takes only so many knocks", () => {
  const hub = createMirrorHub()
  const link = 'L'.repeat(24)
  const app = fakeSocket()
  hub.join(app, 'send', { link })
  const viewer = fakeSocket()
  hub.join(viewer, 'view', { link })
  for (let i = 0; i < 100; i++)
    viewer.onmessage(JSON.stringify({ t: 'code', code: '0000' }))
  assert.equal(app.got.filter((m) => m.t === 'knock').length, 40)
})
