import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sameOriginRequest } from './requestSafety.mjs'
import { createRelay } from './server.mjs'

test('Origin checks accept this host and reject foreign, null and malformed origins', () => {
  const check = (origin, extra = {}) =>
    sameOriginRequest({
      headers: { host: 'chat.example:443', origin, ...extra },
    })
  assert.equal(check('https://chat.example'), true)
  for (const origin of [
    'null',
    'https://evil.example',
    'https://chat.example.evil',
    'https://user@chat.example',
    'https://chat.example/path',
  ])
    assert.equal(check(origin), false)
  assert.equal(check(undefined), true)
  assert.equal(check(undefined, { 'sec-fetch-site': 'cross-site' }), false)
})

test('HTTP cross-origin auth/API calls stop before sending mail or contacting providers', async () => {
  let calls = 0
  const server = createRelay({
    env: {
      LOGIN_EMAIL: 'test@example.com',
      RESEND_API_KEY: 'x',
      XAI_API_KEY: 'x',
    },
    fetchImpl: () => {
      calls++
      throw Error('must not run')
    },
  }).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    for (const path of [
      '/auth/code',
      '/auth/verify',
      '/api/live-token',
      '/api/transcribe',
      '/api/speech-log',
    ]) {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}${path}`,
        { method: 'POST', headers: { origin: 'https://evil.example' } }
      )
      assert.equal(response.status, 403, path)
    }
    assert.equal(calls, 0)
  } finally {
    server.close()
  }
})
