import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRelay,
  liveToken,
  speechLogLine,
  transcribeAll,
  useGrokTicket,
  clipLogLine,
  dictionaryTerms,
} from './server.mjs'

const file = new Blob([new Uint8Array(8)], { type: 'audio/flac' })
const env = { XAI_API_KEY: 'x', ELEVENLABS_API_KEY: 'e' }
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
      engine('grok', 'XAI_API_KEY', 60, 'grok text'),
      engine('elevenlabs', 'ELEVENLABS_API_KEY', 30, 'eleven text'),
    ],
  })
  assert.deepEqual(
    out.map((r) => [r.name, r.ok, r.text]),
    [
      ['grok', true, 'grok text'],
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
      engine('grok', 'XAI_API_KEY', 20, 'fast'),
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
    env: { XAI_API_KEY: 'x' },
    engines: [
      engine('grok', 'XAI_API_KEY', 10, new Error('down')),
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
      engine('grok', 'XAI_API_KEY', 30, 'usable speech'),
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
      engine('grok', 'XAI_API_KEY', 10, ''),
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
      engine('grok', 'XAI_API_KEY', 100, 'later'),
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
      engine('grok', 'XAI_API_KEY', 30, 'usable speech'),
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
        text: url.includes('x.ai') ? 'from grok' : 'from eleven',
      })
    )
  }
  const server = createRelay({
    env: { ELEVENLABS_API_KEY: 'e', XAI_API_KEY: 'x' },
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
      ['from eleven', 'from grok']
    )
    assert.equal(calls.length, 2)
    assert.equal(calls[0].headers['xi-api-key'], 'e')
    assert.equal(calls[1].headers.Authorization, 'Bearer x')
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

test('speech log: Accuracy lines keep only key=value tokens', () => {
  const body = (o) => Buffer.from(JSON.stringify(o))
  const line =
    'accuracy: verdict=approved model=claude-sonnet-5-5 search=skipped total=4210ms failures=groq:timeout,cerebras:claim-span'
  assert.equal(speechLogLine(body({ line })), line)
  assert.equal(
    speechLogLine(body({ line: 'accuracy: verdict=approved question="What is a pod?"' })),
    'speech diagnostic text omitted'
  )
})

test('HTTP: Grok runs with its key and the browser can shorten the wait', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, form: init.body })
    // Grok answers late: past the shortened wait, so it is cut off
    if (url.includes('x.ai')) await new Promise((r) => setTimeout(r, 300))
    return new Response(
      JSON.stringify({ text: url.includes('x.ai') ? 'grok' : 'eleven' })
    )
  }
  const server = createRelay({
    env: { ...env, XAI_API_KEY: 'x' },
    fetchImpl,
  }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array([1])]), 'speaker.flac')
    form.append('engines', 'elevenlabs,grok')
    form.append('wait_ms', '50')
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/transcribe`,
      { method: 'POST', body: form }
    )
    const { results } = await res.json()
    assert.deepEqual(
      results.map((r) => [r.name, r.ok]),
      [
        ['elevenlabs', true],
        ['grok', false],
      ]
    )
    const grok = calls.find((c) => c.url === 'https://api.x.ai/v1/stt')
    assert.equal(grok.auth, 'Bearer x')
    assert.equal(grok.form.get('model'), 'grok-voice-transcribe-2.0')
    const eleven = calls.find((c) => c.url.includes('elevenlabs.io'))
    assert.equal(eleven.form.get('language_code'), 'en')
  } finally {
    server.close()
  }
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
        { name: 'grok', ok: false, ms: 0, off: true, error: 'x' },
        { name: 'soniox', ok: false, ms: 410, error: 'Too slow' },
      ],
      true
    ),
    'clip 1200 B: elevenlabs 400 ms "What is a \\"VPC\\"?", grok off, ' +
      'soniox failed after 410 ms (Too slow)'
  )
})

test('grok live: pipes the browser socket to xAI with the key', async () => {
  const upstreams = []
  class FakeXai {
    constructor(url, init) {
      this.url = url
      this.init = init
      this.sent = []
      this.readyState = 0
      upstreams.push(this)
      setTimeout(() => {
        this.readyState = 1
        this.onmessage({ data: '{"type":"transcript.created"}' })
      }, 30)
    }
    send(data) {
      this.sent.push(data)
      if (typeof data === 'string' && data.includes('audio.done')) {
        this.onmessage({
          data: '{"type":"transcript.done","text":"What is EKS?"}',
        })
        this.readyState = 3
        this.onclose()
      }
    }
    close() {}
  }
  const server = createRelay({
    env: { XAI_API_KEY: 'x' },
    WebSocketImpl: FakeXai,
    log: () => {},
  }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try {
    const ticket = await liveToken({
      env: { XAI_API_KEY: 'x' },
      engine: 'grok',
    })
    assert.match(ticket, /^[0-9a-f]{48}$/)
    const ws = new WebSocket(
      `ws://127.0.0.1:${server.address().port}/api/grok-live?ticket=${ticket}&keyterm=NAT+gateway&keyterm=VPC&keyterm=nat%20gateway&keyterm=${'x'.repeat(51)}`
    )
    const got = []
    const closed = new Promise((r) => (ws.onclose = r))
    ws.onmessage = (e) => got.push(JSON.parse(e.data).type)
    await new Promise((r) => (ws.onopen = r))
    // Sent before xAI is ready: held, then delivered in order
    ws.send(new Uint8Array(3200))
    ws.send(new Uint8Array(70000))
    ws.send(JSON.stringify({ type: 'audio.done' }))
    await closed
    const up = upstreams[0]
    assert.ok(up.url.startsWith('wss://api.x.ai/v1/stt?'))
    assert.equal(new URL(up.url).searchParams.get('encoding'), 'pcm')
    // Key terms pass through, deduplicated, without over-long ones
    assert.deepEqual(new URL(up.url).searchParams.getAll('keyterm'), [
      'NAT gateway',
      'VPC',
    ])
    assert.equal(up.init.headers.Authorization, 'Bearer x')
    assert.deepEqual(
      up.sent.map((d) => (typeof d === 'string' ? d : d.length)),
      [3200, 70000, '{"type":"audio.done"}']
    )
    assert.deepEqual(got, ['transcript.created', 'transcript.done'])
  } finally {
    server.close()
  }
})

test('grok live: refuses a socket without a fresh ticket', async () => {
  const server = createRelay({
    env: { XAI_API_KEY: 'x' },
    log: () => {},
  }).listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  const open = (ticket) =>
    new Promise((resolve) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${server.address().port}/api/grok-live?ticket=${ticket}`
      )
      ws.onopen = () => {
        ws.close()
        resolve('open')
      }
      ws.onerror = () => resolve('refused')
    })
  try {
    assert.equal(await open('nope'), 'refused')
    const ticket = await liveToken({
      env: { XAI_API_KEY: 'x' },
      engine: 'grok',
    })
    assert.equal(useGrokTicket(ticket), true)
    // Single use
    assert.equal(await open(ticket), 'refused')
    await assert.rejects(
      liveToken({ env: {}, engine: 'grok' }),
      (err) => err.status === 503
    )
  } finally {
    server.close()
  }
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
        keyVar: 'XAI_API_KEY',
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
        keyVar: 'XAI_API_KEY',
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
    clipLogLine(8, [{ name: 'grok', ok: true, ms: 20, text: 'secret' }]),
    'clip 8 B: grok 20 ms 6 chars'
  )
  assert.equal(
    speechLogLine(
      Buffer.from(
        JSON.stringify({
          line: 'dictation auto: sent=grok total=25ms grok=20ms | grok: "secret"',
        })
      )
    ),
    'speech dictation auto: sent=grok total=25ms grok=20ms'
  )
  assert.equal(
    speechLogLine(
      Buffer.from(
        JSON.stringify({ line: 'dictation grok: 25 ms after stop, 6 chars' })
      )
    ),
    'speech dictation grok: 25 ms after stop, 6 chars'
  )
  assert.equal(
    speechLogLine(Buffer.from(JSON.stringify({ line: 'secret' }))),
    'speech diagnostic text omitted'
  )
})
