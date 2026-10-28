import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCameraHub, createIceSource, iceServers } from './camera.mjs'
import { cameraKey, cameraKeyOk } from './auth.mjs'
import { createRelay } from './server.mjs'

function fakeSocket() {
  const ws = {
    got: [],
    closed: null,
    send(data) {
      ws.got.push(JSON.parse(data))
    },
    close(code) {
      ws.closed = code
      ws.onclose()
    },
    onmessage: () => {},
    onclose: () => {},
  }
  return ws
}

const quiet = { env: {}, log: () => {} }

test('the hub passes connection setup between the camera and each Meet tab', () => {
  const hub = createCameraHub(quiet)
  const viewer = fakeSocket()
  hub.join(viewer, 'view')
  assert.equal(viewer.got[0].t, 'hello')
  assert.equal(viewer.got[0].sender, false)

  const camera = fakeSocket()
  hub.join(camera, 'send')
  const join = camera.got.find((m) => m.t === 'join')
  assert.ok(join, 'the camera hears about the waiting viewer')
  assert.deepEqual(viewer.got.at(-1), { t: 'sender', on: true })

  camera.onmessage(
    JSON.stringify({ t: 'offer', to: join.from, sdp: 'v=0 offer', extra: 1 })
  )
  assert.deepEqual(viewer.got.at(-1), { t: 'offer', sdp: 'v=0 offer' })
  viewer.onmessage(JSON.stringify({ t: 'answer', sdp: 'v=0 answer' }))
  assert.deepEqual(camera.got.at(-1), {
    t: 'answer',
    sdp: 'v=0 answer',
    from: join.from,
  })
  viewer.onmessage(JSON.stringify({ t: 'ice', candidate: { candidate: 'c' } }))
  assert.deepEqual(camera.got.at(-1), {
    t: 'ice',
    candidate: { candidate: 'c' },
    from: join.from,
  })

  // A presentation starting and stopping reaches the camera page, as a bare on/off
  viewer.onmessage(JSON.stringify({ t: 'screen', on: true, sdp: 'x' }))
  assert.deepEqual(camera.got.at(-1), {
    t: 'screen',
    on: true,
    from: join.from,
  })
  viewer.onmessage(JSON.stringify({ t: 'screen', on: 'yes' }))
  assert.deepEqual(camera.got.at(-1), {
    t: 'screen',
    on: false,
    from: join.from,
  })

  // /mirror asking for a lighter screen reaches the Meet tab, as a bare on/off
  camera.onmessage(
    JSON.stringify({ t: 'light', to: join.from, on: true, sdp: 'x' })
  )
  assert.deepEqual(viewer.got.at(-1), { t: 'light', on: true })
  camera.onmessage(JSON.stringify({ t: 'light', to: join.from, on: 1 }))
  assert.deepEqual(viewer.got.at(-1), { t: 'light', on: false })

  // Unknown messages and pings go nowhere
  const seen = camera.got.length
  viewer.onmessage(JSON.stringify({ t: 'ping' }))
  viewer.onmessage('not json')
  viewer.onmessage(JSON.stringify({ t: 'offer', sdp: 5 }))
  assert.equal(camera.got.length, seen)

  viewer.onclose()
  assert.deepEqual(camera.got.at(-1), { t: 'leave', from: join.from })
  camera.onclose()
  assert.deepEqual(hub.counts, { sender: false, viewers: 0 })
})

test('a new camera page replaces the old one', () => {
  const hub = createCameraHub(quiet)
  const viewer = fakeSocket()
  const first = fakeSocket()
  const second = fakeSocket()
  hub.join(viewer, 'view')
  hub.join(first, 'send')
  hub.join(second, 'send')
  assert.equal(first.closed, 4000)
  assert.ok(second.got.some((m) => m.t === 'join'))
  assert.deepEqual(viewer.got.at(-1), { t: 'sender', on: true })
  assert.equal(hub.counts.sender, true)
})

test('ICE servers come from CAMERA_ICE_SERVERS, else public STUN', () => {
  assert.match(JSON.stringify(iceServers({})), /stun:/)
  const turn = [{ urls: 'turn:t.example', username: 'u', credential: 'p' }]
  assert.deepEqual(
    iceServers({ CAMERA_ICE_SERVERS: JSON.stringify(turn) }),
    turn
  )
  assert.match(
    JSON.stringify(iceServers({ CAMERA_ICE_SERVERS: 'nope' })),
    /stun:/
  )
})

test('the camera key needs sign-in set up and follows the secret', () => {
  assert.equal(cameraKey({}), '')
  assert.equal(cameraKeyOk('', {}), false)
  const env = { LOGIN_EMAIL: 'a@example.com', AUTH_SECRET: 's1' }
  const key = cameraKey(env)
  assert.match(key, /^[0-9a-f]{40}$/)
  assert.equal(cameraKeyOk(key, env), true)
  assert.equal(cameraKeyOk(key.slice(1), env), false)
  assert.equal(cameraKeyOk(key, { ...env, AUTH_SECRET: 's2' }), false)
})

test('the relay accepts /api/camera only with the key', async () => {
  const env = { LOGIN_EMAIL: 'a@example.com', AUTH_SECRET: 's1' }
  const server = createRelay({ env })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `ws://127.0.0.1:${server.address().port}/api/camera`
  const tryOpen = (query) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`${base}?${query}`)
      ws.onmessage = (e) => {
        resolve(JSON.parse(e.data).t)
        ws.close()
      }
      ws.onerror = () => resolve('refused')
    })
  try {
    assert.equal(await tryOpen('role=view&key=wrong'), 'refused')
    assert.equal(await tryOpen(`role=view&key=${cameraKey(env)}`), 'hello')
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/camera-key`,
      { method: 'POST' }
    )
    assert.deepEqual(await res.json(), { key: cameraKey(env) })
  } finally {
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
  }
})

test('camera pings get a pong, and a replaced camera page hears 4000', () => {
  const hub = createCameraHub(quiet)
  const viewer = fakeSocket()
  hub.join(viewer, 'view')
  viewer.onmessage('{"t":"ping"}')
  assert.deepEqual(viewer.got.at(-1), { t: 'pong' })
  const first = fakeSocket()
  hub.join(first, 'send')
  hub.join(fakeSocket(), 'send')
  assert.equal(first.closed, 4000)
})

test('Cloudflare TURN credentials: fetched once, port 53 dropped, STUN on failure', async () => {
  const env = {
    CLOUDFLARE_TURN_KEY_ID: 'abc123',
    CLOUDFLARE_TURN_KEY_TOKEN: 'tok',
  }
  let calls = 0
  let clock = 0
  const fetchImpl = async (url, init) => {
    calls++
    assert.match(
      url,
      /\/turn\/keys\/abc123\/credentials\/generate-ice-servers$/
    )
    assert.equal(init.headers.Authorization, 'Bearer tok')
    return {
      ok: true,
      json: async () => ({
        iceServers: {
          urls: [
            'stun:stun.cloudflare.com:3478',
            'turn:turn.cloudflare.com:53?transport=udp',
            'turns:turn.cloudflare.com:443?transport=tcp',
          ],
          username: 'u',
          credential: 'c',
        },
      }),
    }
  }
  const ice = createIceSource({
    env,
    fetchImpl,
    now: () => clock,
    log: () => {},
  })
  assert.equal(ice.ready(), null, 'nothing yet: the first join waits')
  const list = await ice.load()
  assert.deepEqual(list[0].urls, [
    'stun:stun.cloudflare.com:3478',
    'turns:turn.cloudflare.com:443?transport=tcp',
  ])
  assert.equal(ice.ready(), list)
  assert.equal(calls, 1)
  // Past half-life: still served at once, refreshed in the background
  clock = 13 * 60 * 60 * 1000
  assert.equal(ice.ready(), list)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(calls, 2)

  // Cloudflare down: public STUN, and no waiting on it for a minute
  const down = createIceSource({
    env,
    fetchImpl: async () => ({ ok: false, status: 503 }),
    now: () => 0,
    log: () => {},
  })
  assert.match(JSON.stringify(await down.load()), /stun\.l\.google/)
  assert.match(JSON.stringify(down.ready()), /stun\.l\.google/)

  // Without the key: the old list, at once
  assert.match(JSON.stringify(createIceSource({ env: {} }).ready()), /stun:/)
})

test('a join waits for the first TURN credentials, then says hello with them', async () => {
  let release
  const turn = [{ urls: 'turns:t.example:443', username: 'u', credential: 'c' }]
  const ice = {
    ready: () => null,
    load: () => new Promise((r) => (release = () => r(turn))),
  }
  const hub = createCameraHub({ ...quiet, ice })
  const viewer = fakeSocket()
  hub.join(viewer, 'view')
  assert.equal(viewer.got.length, 0)
  release()
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(viewer.got[0].ice, turn)
  assert.equal(hub.counts.viewers, 1)
})

test('a Meet tab reconnecting with its id stays the same viewer', () => {
  const hub = createCameraHub(quiet)
  const camera = fakeSocket()
  hub.join(camera, 'send')
  const vid = 'tab-0123456789abcdef'
  const first = fakeSocket()
  hub.join(first, 'view', { vid })
  assert.deepEqual(camera.got.at(-1), { t: 'join', from: vid })
  // The same tab again before its old socket closed: the old one goes
  // quietly, and the camera page hears a join for the same id, no leave
  const second = fakeSocket()
  hub.join(second, 'view', { vid })
  assert.equal(first.closed, undefined)
  assert.deepEqual(camera.got.at(-1), { t: 'join', from: vid })
  assert.ok(!camera.got.some((m) => m.t === 'leave'))
  assert.equal(hub.counts.viewers, 1)
  second.onmessage(JSON.stringify({ t: 'answer', sdp: 'a' }))
  assert.deepEqual(camera.got.at(-1), { t: 'answer', sdp: 'a', from: vid })
  // An id that isn't one gets a random one instead
  const odd = fakeSocket()
  hub.join(odd, 'view', { vid: 'x"y' })
  assert.match(camera.got.at(-1).from, /^[0-9a-f]{16}$/)
})

test("a link's remote camera is cut off when the link ends", async () => {
  const server = createRelay({ env: {} })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `ws://127.0.0.1:${server.address().port}`
  const link = 'L'.repeat(24)
  const opened = (url) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.onopen = () => resolve(ws)
      ws.onerror = () => reject(new Error('refused'))
    })
  try {
    const app = await opened(
      `${base}/api/mirror?role=send&link=${link}&born=${Date.now()}`
    )
    const cam = await opened(`${base}/api/camera?role=send&link=${link}`)
    const closed = new Promise((r) => (cam.onclose = (e) => r(e.code)))
    app.send(JSON.stringify({ t: 'revoke', link }))
    assert.equal(await closed, 4001)
    // and the link no longer lets a camera in
    await assert.rejects(opened(`${base}/api/camera?role=send&link=${link}`))
    app.close()
  } finally {
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
  }
})
