import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRelay,
  liveToken,
  speechLogLine,
  transcribeAll,
  clipLogLine,
  dictionaryTerms,
  azureToken,
} from './server.mjs'

const file = new Blob([new Uint8Array(8)], { type: 'audio/flac' })
const env = { OTHER_KEY: 'x', ELEVENLABS_API_KEY: 'e' }
const engine = (name, keyVar, ms, text) => ({
  name,
  keyVar,
  run: (_file, _key, signal) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(
        () => (text instanceof Error ? reject(text) : resolve(text)),
        ms
      )
      signal.addEventListener('abort', () => clearTimeout(t))
    }),
})

test('returns both transcripts, in engine order, when both answer in time', async () => {
  const out = await transcribeAll(file, {
    env,
    engines: [
      engine('other', 'OTHER_KEY', 60, 'other text'),
      engine('elevenlabs', 'ELEVENLABS_API_KEY', 30, 'eleven text'),
    ],
  })
  assert.deepEqual(
    out.map((r) => [r.name, r.ok, r.text]),
    [
      ['other', true, 'other text'],
      ['elevenlabs', true, 'eleven text'],
    ]
  )
})

test('waits only the cap for the slower engine', async () => {
  const started = Date.now()
  const out = await transcribeAll(file, {
    env,
    waitMs: 50,
    engines: [
      engine('other', 'OTHER_KEY', 20, 'fast'),
      engine('elevenlabs', 'ELEVENLABS_API_KEY', 2000, 'late'),
    ],
  })
  assert.ok(Date.now() - started < 500)
  assert.equal(out[0].text, 'fast')
  assert.equal(out[1].ok, false)
  assert.equal(out[1].error, 'Too slow')
})

test('reports failures and skips engines with no key', async () => {
  const out = await transcribeAll(file, {
    env: { OTHER_KEY: 'x' },
    engines: [
      engine('other', 'OTHER_KEY', 10, new Error('down')),
      engine('elevenlabs', 'ELEVENLABS_API_KEY', 10, 'x'),
    ],
  })
  assert.equal(out[0].ok, false)
  assert.equal(out[0].error, 'down')
  assert.equal(out[1].off, true)
})

test('dictation race ignores an empty result and does not start the slower-engine cap until speech arrives', async () => {
  const out = await transcribeAll(file, {
    env,
    need: 1,
    requireText: true,
    waitMs: 1,
    engines: [
      engine('elevenlabs', 'ELEVENLABS_API_KEY', 0, '  '),
      engine('other', 'OTHER_KEY', 30, 'usable speech'),
    ],
  })
  assert.equal(out[1].text, 'usable speech')
  assert.equal(out[1].ok, true)
})
test('dictation race resolves when all engines hear nothing', async () => {
  const out = await transcribeAll(file, {
    env,
    need: 1,
    requireText: true,
    engines: [
      engine('elevenlabs', 'ELEVENLABS_API_KEY', 0, ''),
      engine('other', 'OTHER_KEY', 10, ''),
    ],
  })
  assert.equal(out.length, 2)
  assert.ok(out.every((r) => r.ok && r.text === ''))
})
test('legacy transcription race behavior is unchanged without the dictation option', async () => {
  const out = await transcribeAll(file, {
    env,
    need: 1,
    engines: [
      engine('elevenlabs', 'ELEVENLABS_API_KEY', 0, ''),
      engine('other', 'OTHER_KEY', 100, 'later'),
    ],
  })
  assert.equal(out[0].text, '')
  assert.equal(out[1].error, 'Too slow')
})
test('HTTP: dictation require_text option waits for nonempty speech', async () => {
  const server = createRelay({
    env,
    waitMs: 1,
    engines: [
      engine('elevenlabs', 'ELEVENLABS_API_KEY', 0, ''),
      engine('other', 'OTHER_KEY', 30, 'usable speech'),
    ],
  }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try {
    const form = new FormData()
    form.append('file', file, 'dictation.wav')
    form.append('need', '1')
    form.append('require_text', '1')
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/transcribe`,
      { method: 'POST', body: form }
    )
    assert.equal(res.status, 200)
    assert.equal((await res.json()).results[1].text, 'usable speech')
  } finally {
    server.close()
  }
})

test('HTTP: one upload reaches every engine with its key', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, file: init.body.get('file') })
    return new Response(
      JSON.stringify({
        text: 'from eleven',
      })
    )
  }
  const server = createRelay({
    env: { ELEVENLABS_API_KEY: 'e' },
    fetchImpl,
  }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try {
    const form = new FormData()
    form.append(
      'file',
      new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/flac' }),
      'speaker.flac'
    )
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/transcribe`,
      { method: 'POST', body: form }
    )
    assert.equal(res.status, 200)
    const { results } = await res.json()
    assert.deepEqual(
      results.filter((r) => !r.off).map((r) => r.text),
      ['from eleven']
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0].headers['xi-api-key'], 'e')
    assert.equal(calls[0].file.size, 3)
    assert.equal(calls[0].file.type, 'audio/flac')
  } finally {
    server.close()
  }
})

test('HTTP: engines field limits which engines run', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    return new Response(JSON.stringify({ text: 'from eleven' }))
  }
  const server = createRelay({ env, fetchImpl }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array([1])]), 'speaker.flac')
    form.append('engines', 'elevenlabs')
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/transcribe`,
      { method: 'POST', body: form }
    )
    assert.equal(res.status, 200)
    const { results } = await res.json()
    assert.deepEqual(
      results.map((r) => r.name),
      ['elevenlabs']
    )
    assert.equal(calls.length, 1)
    assert.ok(calls[0].includes('elevenlabs'))
  } finally {
    server.close()
  }
})

test('HTTP: 503 when no engine has a key', async () => {
  const server = createRelay({ env: {} }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(4)]), 'speaker.flac')
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/transcribe`,
      { method: 'POST', body: form }
    )
    assert.equal(res.status, 503)
  } finally {
    server.close()
  }
})

test('live token: trades the ElevenLabs key for a single-use token', async () => {
  const calls = []
  const token = await liveToken({
    env: { ELEVENLABS_API_KEY: 'e' },
    fetchImpl: async (url, init) => {
      calls.push([url, init.headers['xi-api-key']])
      return { ok: true, json: async () => ({ token: 'sutkn_1' }) }
    },
  })
  assert.equal(token, 'sutkn_1')
  assert.deepEqual(calls, [
    ['https://api.elevenlabs.io/v1/single-use-token/realtime_scribe', 'e'],
  ])
})

test('live token: 503 without an ElevenLabs key', async () => {
  await assert.rejects(liveToken({ env: {} }), (err) => err.status === 503)
})

test('speech log: one capped line per clip', () => {
  const body = (o) => Buffer.from(JSON.stringify(o))
  assert.equal(
    speechLogLine(
      body({ line: 'sent "What is a pod?"\n| ElevenLabs 0.3 s' }),
      true
    ),
    'speech sent "What is a pod?" | ElevenLabs 0.3 s'
  )
  assert.equal(
    speechLogLine(body({ line: 'x'.repeat(9000) }), true).length,
    6007
  )
  assert.equal(speechLogLine(body({})), null)
  assert.equal(speechLogLine(Buffer.from('not json')), null)
})

test('speech log: Windows key waits keep only their numbers', () => {
  const body = (o) => Buffer.from(JSON.stringify(o))
  assert.equal(
    speechLogLine(body({ line: 'windows key: waited=1840ms mirror=pointer' })),
    'speech windows key: waited=1840ms mirror=pointer'
  )
  assert.equal(
    speechLogLine(body({ line: 'windows key: waited=1840ms mirror=secret' })),
    'speech diagnostic text omitted'
  )
})

test('speech log: Accuracy lines keep only key=value tokens', () => {
  const body = (o) => Buffer.from(JSON.stringify(o))
  const line =
    'accuracy: verdict=approved model=gpt-oss-120b search=skipped total=4210ms failures=groq:timeout,cerebras:claim-span'
  assert.equal(speechLogLine(body({ line })), line)
  assert.equal(
    speechLogLine(
      body({ line: 'accuracy: verdict=approved question="What is a pod?"' })
    ),
    'speech diagnostic text omitted'
  )
})

test('race: returns as soon as two engines answer', async () => {
  const started = Date.now()
  const out = await transcribeAll(file, {
    env: { A: 'a', B: 'b', C: 'c' },
    need: 2,
    engines: [
      engine('slow', 'A', 1000, 'slow'),
      engine('fast', 'B', 20, 'fast'),
      engine('mid', 'C', 60, 'mid'),
    ],
  })
  assert.ok(Date.now() - started < 500)
  assert.deepEqual(
    out.map((r) => [r.name, r.ok]),
    [
      ['slow', false],
      ['fast', true],
      ['mid', true],
    ]
  )
})

test('the clip log line carries each engine’s words', () => {
  assert.equal(
    clipLogLine(
      1200,
      [
        { name: 'elevenlabs', ok: true, ms: 400, text: 'What is a "VPC"?' },
        { name: 'other', ok: false, ms: 0, off: true, error: 'x' },
        { name: 'soniox', ok: false, ms: 410, error: 'Too slow' },
      ],
      true
    ),
    'clip 1200 B: elevenlabs 400 ms "What is a \\"VPC\\"?", other off, ' +
      'soniox failed after 410 ms (Too slow)'
  )
})

test('soniox live: a temporary key plus the dictionary as terms', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({
      url,
      auth: init.headers.Authorization,
      body: JSON.parse(init.body),
    })
    return new Response(JSON.stringify({ api_key: 'temp:1', expires_at: 'x' }))
  }
  const server = createRelay({
    env: { SONIOX_API_KEY: 's' },
    fetchImpl,
  }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/live-token`,
      { method: 'POST', body: JSON.stringify({ engine: 'soniox' }) }
    )
    assert.equal(res.status, 200)
    const { token, terms } = await res.json()
    assert.equal(token, 'temp:1')
    assert.ok(terms.includes('kubectl'))
    assert.ok(terms.includes('Services (ClusterIP, NodePort, LoadBalancer)'))
    assert.deepEqual(calls, [
      {
        url: 'https://api.soniox.com/v1/auth/temporary-api-key',
        auth: 'Bearer s',
        body: { usage_type: 'transcribe_websocket', expires_in_seconds: 60 },
      },
    ])
  } finally {
    server.close()
  }
  await assert.rejects(
    liveToken({ env: {}, engine: 'soniox' }),
    (err) => err.status === 503
  )
})

test('dictionary: one term per line, split at commas outside brackets', () => {
  const terms = dictionaryTerms()
  for (const t of ['Pods', 'ReplicaSets', 'MTTR', 'MTTD', 'Wireshark'])
    assert.ok(terms.includes(t), t)
  assert.ok(terms.includes('Log Levels: DEBUG/INFO/WARN/ERROR/FATAL'))
  // No duplicates (MTTR is listed twice), no trailing dots
  assert.equal(new Set(terms.map((t) => t.toLowerCase())).size, terms.length)
  assert.ok(!terms.includes('Kustomize.'))
  // Wispr Flow's words are merged in, and its correction targets added
  for (const t of ['Liquibase', 'LiteLLM', 'Zscaler'])
    assert.ok(terms.includes(t), t)
})

test('cartesia live: an STT-only access token plus the dictionary', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({
      url,
      auth: init.headers.Authorization,
      version: init.headers['Cartesia-Version'],
      body: JSON.parse(init.body),
    })
    return new Response(JSON.stringify({ token: 'cart_tok' }))
  }
  const server = createRelay({
    env: { CARTESIA_API_KEY: 'c' },
    fetchImpl,
  }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/live-token`,
      { method: 'POST', body: JSON.stringify({ engine: 'cartesia' }) }
    )
    assert.equal(res.status, 200)
    const { token, terms } = await res.json()
    assert.equal(token, 'cart_tok')
    assert.ok(terms.includes('kubectl'))
    assert.deepEqual(calls, [
      {
        url: 'https://api.cartesia.ai/access-token',
        auth: 'Bearer c',
        version: '2026-08-14',
        body: { grants: { stt: true }, expires_in: 600 },
      },
    ])
  } finally {
    server.close()
  }
  await assert.rejects(
    liveToken({ env: {}, engine: 'cartesia' }),
    (err) => err.status === 503
  )
})

test('absolute deadline resolves even if no engine honors cancellation', async () => {
  const started = Date.now()
  const out = await transcribeAll(file, {
    env,
    timeoutMs: 15,
    engines: [
      {
        name: 'stuck',
        keyVar: 'OTHER_KEY',
        run: () => new Promise(() => {}),
      },
    ],
  })
  assert.ok(Date.now() - started < 500)
  assert.equal(out[0].error, 'Too slow')
})

test('client cancellation releases the transcription race and aborts engines', async () => {
  const controller = new AbortController()
  let engineSignal
  const pending = transcribeAll(file, {
    env,
    signal: controller.signal,
    engines: [
      {
        name: 'stuck',
        keyVar: 'OTHER_KEY',
        run: (_file, _key, signal) => {
          engineSignal = signal
          return new Promise(() => {})
        },
      },
    ],
  })
  await Promise.resolve()
  controller.abort()
  await pending
  assert.equal(engineSignal.aborted, true)
})

test('default diagnostics keep timings while withholding transcript text', () => {
  assert.equal(
    clipLogLine(8, [{ name: 'other', ok: true, ms: 20, text: 'secret' }]),
    'clip 8 B: other 20 ms 6 chars'
  )
  assert.equal(
    speechLogLine(
      Buffer.from(
        JSON.stringify({
          line: 'dictation auto: sent=other total=25ms other=20ms | other: "secret"',
        })
      )
    ),
    'speech dictation auto: sent=other total=25ms other=20ms'
  )
  assert.equal(
    speechLogLine(
      Buffer.from(
        JSON.stringify({ line: 'dictation other: 25 ms after stop, 6 chars' })
      )
    ),
    'speech dictation other: 25 ms after stop, 6 chars'
  )
  assert.equal(
    speechLogLine(Buffer.from(JSON.stringify({ line: 'secret' }))),
    'speech diagnostic text omitted'
  )
})

test('Accuracy telemetry rejects arbitrary text disguised as metadata', () => {
  for (const line of [
    'accuracy: question=private_question',
    'accuracy: verdict=approved model=private_secret',
    'accuracy: failures=groq:private_secret',
    'accuracy: reviewers=claude:private_secret',
    // Claude is no longer a reviewer or a model
    'accuracy: reviewers=claude:3400ms:ok',
    'accuracy: verdict=direct model=claude-sonnet-5-5',
    'accuracy: total=123ms total=456ms',
  ])
    assert.equal(
      speechLogLine(Buffer.from(JSON.stringify({ line }))),
      'speech diagnostic text omitted'
    )
  const line =
    'accuracy: verdict=revised model=gpt-oss-120b search=ready sources=5 total=4210ms search_time=300ms draft=500ms review=3410ms claims=4 context_claims=1 unsupported=0 fallback=none failures=groq:timeout reviewers=cerebras:3400ms:ok,groq:cancelled'
  assert.equal(speechLogLine(Buffer.from(JSON.stringify({ line }))), line)
  // The client logs the provider's actual HTTP status (provider-400, provider-529).
  const statusLine =
    'accuracy: verdict=unverified model=gpt-oss-120b search=ready sources=5 total=12844ms search_time=1066ms draft=1751ms review=10023ms claims=0 context_claims=0 unsupported=0 fallback=reviewer-answer failures=cerebras:source-reference,groq:provider-529 reviewers=cerebras:1520ms:source-reference,groq:7770ms:provider-529,cerebras-repair:10022ms:ok'
  assert.equal(
    speechLogLine(Buffer.from(JSON.stringify({ line: statusLine }))),
    statusLine
  )
  assert.equal(
    speechLogLine(
      Buffer.from(
        JSON.stringify({ line: 'accuracy: failures=groq:provider-4000' })
      )
    ),
    'speech diagnostic text omitted'
  )
  // An answer logs its time to first words.
  const first =
    'accuracy: verdict=approved model=gpt-oss-120b search=ready sources=5 total=5210ms search_time=700ms draft=4100ms review=300ms claims=3 context_claims=0 unsupported=0 fallback=none failures=none reviewers=cerebras:300ms:ok first=1900ms'
  assert.equal(
    speechLogLine(Buffer.from(JSON.stringify({ line: first }))),
    first
  )
})

test('speech log: Speed lines keep timings and reject anything else', () => {
  const body = (line) => Buffer.from(JSON.stringify({ line }))
  const line =
    'speed: model=openai_gpt-oss-20b total=1830ms first_byte=210ms first_words=420ms answer=1410ms tokens=312 route=direct hidden=no'
  assert.equal(speechLogLine(body(line)), line)
  // Today's line, with the provider's own times and the cached part of the prompt
  const full =
    'speed: model=openai_gpt-oss-120b total=900ms first_byte=200ms first_words=300ms answer=600ms tokens=80 prompt_tokens=9100 cached=8960 queue=12ms prompt=45ms request=39KB route=server hidden=no'
  assert.equal(speechLogLine(body(full)), full)
  const noCache = full.replace(' cached=8960', '')
  assert.equal(speechLogLine(body(noCache)), noCache)
  // With how it looked: the answer's place appearing, and stutters
  const frames = full.replace(' route=', ' shown=16ms stalls=0 route=')
  assert.equal(speechLogLine(body(frames)), frames)
  assert.equal(
    speechLogLine(body(frames.replace('stalls=0', 'stalls=x'))),
    'speech diagnostic text omitted'
  )
  assert.equal(
    speechLogLine(body(line.replace('hidden=no', 'hidden=no question=secret'))),
    'speech diagnostic text omitted'
  )
  assert.equal(
    speechLogLine(body(line.replace('openai_gpt-oss-20b', 'private_text'))),
    'speech diagnostic text omitted'
  )
  // Auto mode, thinking level, thinking tokens and stop speaking → first word
  const instant = `${full} mode=instant effort=low reasoning=42 from_stop=780ms`
  assert.equal(speechLogLine(body(instant)), instant)
  assert.equal(
    speechLogLine(body(instant.replace('effort=low', 'effort=secret'))),
    'speech diagnostic text omitted'
  )
})

test('azure live: the key becomes a region-tagged token, never sent itself', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers })
    return new Response('tok123')
  }
  const env = { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: ' CentralIndia ' }
  assert.equal(await azureToken({ env, fetchImpl }), 'centralindia:tok123')
  assert.equal(
    calls[0].url,
    'https://centralindia.api.cognitive.microsoft.com/sts/v1.0/issueToken'
  )
  assert.equal(calls[0].headers['Ocp-Apim-Subscription-Key'], 'k')
  assert.equal(
    await liveToken({ env, fetchImpl, engine: 'azure' }),
    'centralindia:tok123'
  )
  await assert.rejects(azureToken({ env: {}, fetchImpl }), { status: 503 })
  await assert.rejects(
    azureToken({
      env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'evil.com/x' },
      fetchImpl,
    }),
    { status: 503 }
  )
})

test('mirror link: an unknown or ended link is told so (4001), not refused', async () => {
  const { request } = await import('node:http')
  const server = createRelay({ env: {} }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try {
    const frame = await new Promise((resolve, reject) => {
      const req = request({
        host: '127.0.0.1',
        port: server.address().port,
        path: `/api/mirror-link?link=${'A'.repeat(24)}`,
        headers: {
          'connection': 'Upgrade',
          'upgrade': 'websocket',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'sec-websocket-version': '13',
        },
      })
      req.on('upgrade', (res, socket, head) => {
        assert.equal(res.statusCode, 101)
        const chunks = [head]
        socket.on('data', (d) => chunks.push(d))
        socket.on('end', () => resolve(Buffer.concat(chunks)))
        socket.on('error', reject)
      })
      req.on('response', (res) => reject(new Error(`HTTP ${res.statusCode}`)))
      req.on('error', reject)
      req.end()
    })
    // A close frame (opcode 8) carrying code 4001
    assert.equal(frame[0] & 0x0f, 8)
    assert.equal(frame.readUInt16BE(2), 4001)
  } finally {
    server.close()
  }
})
