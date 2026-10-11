import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchWeb } from './search.mjs'
import { createRelay } from './server.mjs'

test('Exa uses Fast search, keeps the key server-side and bounds safe source content', async () => {
  let request
  const result = await searchWeb('Which AWS service is cheaper?', {
    env: { EXA_API_KEY: 'private-test-key' },
    fetchImpl: async (url, init) => {
      request = { url, init }
      return Response.json({
        results: [
          {
            url: 'https://docs.example.com',
            title: 'Docs',
            text: 'x'.repeat(5000),
          },
          { url: 'javascript:alert(1)', text: 'Unsafe' },
          { url: 'https://user:pass@example.com', text: 'Credentials' },
          { url: 'https://example.com/empty', text: '' },
        ],
      })
    },
  })
  assert.equal(request.url, 'https://api.exa.ai/search')
  assert.equal(request.init.headers['x-api-key'], 'private-test-key')
  assert.equal(JSON.parse(request.init.body).type, 'fast')
  assert.equal(JSON.parse(request.init.body).numResults, 5)
  assert.equal(result.status, 'ready')
  assert.equal(result.sources.length, 1)
  assert.equal(result.sources[0].text.length, 2500)
  assert.ok(!JSON.stringify(result).includes('private-test-key'))
})

test('Exa does not pretend to search without a key and does not echo provider errors', async () => {
  assert.deepEqual(
    await searchWeb('Question', {
      env: {},
      fetchImpl() {
        throw Error('must not run')
      },
    }),
    { status: 'unconfigured', sources: [] }
  )
  assert.deepEqual(
    await searchWeb('Question', {
      env: { EXA_API_KEY: 'key' },
      fetchImpl: async () =>
        new Response('private error details', { status: 401 }),
    }),
    { status: 'unavailable', sources: [] }
  )
})

test('Exa deadline settles even when fetch ignores cancellation', async () => {
  const result = await searchWeb('Question', {
    env: { EXA_API_KEY: 'key' },
    timeoutMs: 10,
    fetchImpl: () => new Promise(() => {}),
  })
  assert.deepEqual(result, { status: 'unavailable', sources: [] })
})

test('Search endpoint validates queries and refuses cross-origin use before contacting Exa', async () => {
  let calls = 0
  const server = createRelay({
    env: { EXA_API_KEY: 'key' },
    fetchImpl: async () => {
      calls++
      return Response.json({
        results: [
          { url: 'https://docs.example.com', title: 'Docs', text: 'Evidence' },
        ],
      })
    },
  }).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}/api/search`
  try {
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { origin: 'https://evil.example' },
          body: JSON.stringify({ query: 'Question' }),
        })
      ).status,
      403
    )
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          body: JSON.stringify({ query: 'x'.repeat(4001) }),
        })
      ).status,
      400
    )
    assert.equal(calls, 0)
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ query: 'Question' }),
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).status, 'ready')
    assert.equal(calls, 1)
  } finally {
    server.close()
  }
})
