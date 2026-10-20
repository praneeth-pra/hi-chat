import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCameraHub, iceServers } from './camera.mjs'
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
