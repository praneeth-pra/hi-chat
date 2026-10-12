import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkCode,
  newCode,
  resetCodes,
  sessionToken,
  signedIn,
} from './auth.mjs'
import { createRelay } from './server.mjs'

const env = {
  LOGIN_EMAIL: 'Info.hi-techie@gmail.com',
  RESEND_API_KEY: 'k',
}

beforeEach(resetCodes)

test('no LOGIN_EMAIL: nobody is signed in, even with a cookie', () => {
  const token = sessionToken({}, Date.now() + 60_000)
  assert.equal(signedIn(`hc_auth=${token}`, {}), false)
})

test('session cookie: valid, expired, tampered, other secret', () => {
  const now = Date.now()
  const good = sessionToken(env, now + 60_000)
  assert.equal(signedIn(`a=1; hc_auth=${good}`, env, now), true)
  assert.equal(
    signedIn(`hc_auth=${sessionToken(env, now - 1)}`, env, now),
    false
  )
  const changed = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0')
  assert.equal(signedIn(`hc_auth=${changed}`, env, now), false)
  assert.equal(signedIn(`hc_auth=${good}extra`, env, now), false)
  assert.equal(
    signedIn(`hc_auth=${good}`, { ...env, RESEND_API_KEY: 'other' }, now),
    false
  )
  assert.equal(signedIn('', env, now), false)
})

test('codes: right code once, wrong codes, five tries, expiry, ask limits', () => {
  const t = 1_000_000
  const code = newCode(t)
  assert.match(code, /^\d{6}$/)
  assert.equal(newCode(t + 1000), 'wait')
  assert.equal(checkCode('x', t), 'wrong')
  assert.equal(checkCode(code, t), 'ok')
  assert.equal(checkCode(code, t), 'expired') // spent

  const c2 = newCode(t + 31_000)
  for (let i = 0; i < 5; i++)
    assert.equal(
      checkCode('000000' === c2 ? '111111' : '000000', t + 31_000),
      'wrong'
    )
  assert.equal(checkCode(c2, t + 31_000), 'expired') // out of tries

  const c3 = newCode(t + 62_000)
  assert.equal(checkCode(c3, t + 62_000 + 11 * 60_000), 'expired')

  newCode(t + 93_000)
  newCode(t + 124_000)
  assert.equal(newCode(t + 155_000), 'limit') // five an hour
})

async function call(server, path, init = {}) {
  const { port } = server.address()
  return fetch(`http://127.0.0.1:${port}${path}`, {
    redirect: 'manual',
    ...init,
  })
}

test('relay: check, login page, email a code, sign in with it', async () => {
  const sent = []
  const fetchImpl = async (url, init) => {
    sent.push({
      url,
      body: JSON.parse(init.body),
      auth: init.headers.Authorization,
    })
    return new Response('{}', { status: 200 })
  }
  const server = createRelay({ env, fetchImpl }).listen(0)
  await new Promise((r) => server.once('listening', r))
  try {
    assert.equal((await call(server, '/auth/check')).status, 401)
    const page = await call(server, '/login')
    assert.equal(page.status, 200)
    assert.match(await page.text(), /in\*\*\*@gmail\.com/)

    assert.equal(
      (await call(server, '/auth/code', { method: 'POST' })).status,
      200
    )
    assert.equal(sent[0].url, 'https://api.resend.com/emails')
    assert.deepEqual(sent[0].body.to, ['info.hi-techie@gmail.com'])
    assert.equal(sent[0].auth, 'Bearer k')
    const code = sent[0].body.subject.match(/\d{6}/)[0]

    const bad = await call(server, '/auth/verify', {
      method: 'POST',
      body: '{"code":"abc"}',
    })
    assert.equal(bad.status, 401)
    const ok = await call(server, '/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
    assert.equal(ok.status, 200)
    const cookie = ok.headers.get('set-cookie')
    assert.match(
      cookie,
      /^hc_auth=\d+\.[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Lax/
    )

    const headers = { cookie: cookie.split(';')[0] }
    assert.equal((await call(server, '/auth/check', { headers })).status, 204)
    assert.equal((await call(server, '/login', { headers })).status, 302)
  } finally {
    server.close()
  }
})

test('relay: without LOGIN_EMAIL, codes are refused', async () => {
  const server = createRelay({ env: { RESEND_API_KEY: 'k' } }).listen(0)
  await new Promise((r) => server.once('listening', r))
  try {
    assert.equal((await call(server, '/auth/check')).status, 401)
    assert.equal(
      (await call(server, '/auth/code', { method: 'POST' })).status,
      503
    )
  } finally {
    server.close()
  }
})

test('relay: a failed email says so', async () => {
  const server = createRelay({
    env,
    fetchImpl: async () => new Response('no', { status: 403 }),
  }).listen(0)
  await new Promise((r) => server.once('listening', r))
  try {
    assert.equal(
      (await call(server, '/auth/code', { method: 'POST' })).status,
      502
    )
  } finally {
    server.close()
  }
})
