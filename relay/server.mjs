// Transcription relay: the browser uploads each clip once to
// /api/transcribe; this sends it to every engine with a key at the same time,
// adding the keys (ELEVENLABS_API_KEY, XAI_API_KEY, ASSEMBLYAI_API_KEY) so
// they never reach the browser. nginx checks the relay token before forwarding here.
//
// Once one engine answers, the others get SECOND_ENGINE_WAIT_MS more (the
// browser can ask for less); whatever has arrived by then is returned in
// ENGINES order. In a race (`need`), it returns as soon as that many answered.

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { flacToWav } from './flacToWav.mjs'
import { randomBytes } from 'node:crypto'
import { acceptWebSocket, cleanKeyterms, grokLive } from './wsProxy.mjs'

// The longest the others wait once one engine has answered (the browser asks
// for less).
export const SECOND_ENGINE_WAIT_MS = 1500
const MAX_BODY_BYTES = 25 * 1024 * 1024
const ENGINE_TIMEOUT_MS = 200_000

export const ENGINES = [
  {
    name: 'elevenlabs',
    keyVar: 'ELEVENLABS_API_KEY',
    async run(file, key, signal, fetchImpl) {
      const form = new FormData()
      form.append('file', file, file.name || 'speaker.flac')
      form.append('model_id', 'scribe_v2')
      form.append('tag_audio_events', 'false')
      form.append('no_verbatim', 'true')
      form.append('language_code', 'en')
      const res = await fetchImpl(
        'https://api.elevenlabs.io/v1/speech-to-text',
        {
          method: 'POST',
          headers: { 'xi-api-key': key },
          body: form,
          signal,
        }
      )
      if (!res.ok)
        throw new Error(
          `ElevenLabs failed (${res.status}): ${await errorText(res)}`
        )
      return (await res.json()).text ?? ''
    },
  },
  {
    // Grok Voice Transcribe 2.0: about as accurate as ElevenLabs and faster
    name: 'grok',
    keyVar: 'XAI_API_KEY',
    async run(file, key, signal, fetchImpl) {
      const form = new FormData()
      form.append('file', file, file.name || 'speaker.flac')
      form.append('model', 'grok-voice-transcribe-2.0')
      form.append('language', 'en')
      const res = await fetchImpl('https://api.x.ai/v1/stt', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal,
      })
      if (!res.ok)
        throw new Error(`Grok failed (${res.status}): ${await errorText(res)}`)
      return (await res.json()).text ?? ''
    },
  },
  {
    // AssemblyAI's Sync API answers short clips in one request; it takes WAV,
    // not FLAC, so the clip is unpacked here first.
    name: 'assemblyai',
    keyVar: 'ASSEMBLYAI_API_KEY',
    async run(file, key, signal, fetchImpl) {
      const form = new FormData()
      form.append('audio', await flacToWav(file), 'speaker.wav')
      const res = await fetchImpl('https://sync.assemblyai.com/v1/transcribe', {
        method: 'POST',
        headers: { 'Authorization': key, 'X-AAI-Model': 'universal-3-5-pro' },
        body: form,
        signal,
      })
      if (!res.ok)
        throw new Error(
          `AssemblyAI failed (${res.status}): ${await errorText(res)}`
        )
      return (await res.json()).text ?? ''
    },
  },
]

async function errorText(res) {
  try {
    return (await res.text()).slice(0, 200)
  } catch {
    return ''
  }
}

/**
 * Runs every engine on `file` and resolves with one result per engine:
 * { name, ok, ms, text? , error?, off? }. `off` means the engine has no key.
 */
export function transcribeAll(
  file,
  {
    env = process.env,
    engines = ENGINES,
    fetchImpl = fetch,
    waitMs = SECOND_ENGINE_WAIT_MS,
    // Stop as soon as this many engines have answered (a race)
    need = Infinity,
  } = {}
) {
  return new Promise((resolve) => {
    const started = Date.now()
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), ENGINE_TIMEOUT_MS)
    const results = engines.map((e) =>
      env[e.keyVar]
        ? null
        : {
            name: e.name,
            ok: false,
            ms: 0,
            off: true,
            error: `${e.keyVar} not set`,
          }
    )
    let running = results.filter((r) => r === null).length
    let timer
    let done = false

    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearTimeout(timeout)
      abort.abort()
      resolve(
        results.map(
          (r, i) =>
            r ?? {
              name: engines[i].name,
              ok: false,
              ms: Date.now() - started,
              error: 'Too slow',
            }
        )
      )
    }

    if (running === 0) return finish()

    engines.forEach((engine, i) => {
      if (results[i]) return
      engine
        .run(file, env[engine.keyVar], abort.signal, fetchImpl)
        .then((text) => {
          if (!done)
            results[i] = {
              name: engine.name,
              ok: true,
              ms: Date.now() - started,
              text,
            }
        })
        .catch((err) => {
          if (!done)
            results[i] = {
              name: engine.name,
              ok: false,
              ms: Date.now() - started,
              error: err.message,
            }
        })
        .finally(() => {
          running--
          if (running === 0 || results.filter((r) => r?.ok).length >= need)
            finish()
          else if (!timer && results.some((r) => r?.ok))
            timer = setTimeout(finish, waitMs)
        })
    })
  })
}

/**
 * One line per clip, so slow or failing engines show in Railway's logs. Each
 * engine's own words are included so their accuracy can be compared.
 */
export function clipLogLine(size, results) {
  return (
    `clip ${size} B: ` +
    results
      .map((r) =>
        r.off
          ? `${r.name} off`
          : r.ok
            ? `${r.name} ${r.ms} ms ${JSON.stringify(String(r.text).slice(0, 400))}`
            : `${r.name} failed after ${r.ms} ms (${r.error})`
      )
      .join(', ')
  )
}

/**
 * Live mode: a single-use ElevenLabs token (valid 15 minutes) lets the browser
 * stream audio straight to ElevenLabs' realtime model without ever seeing
 * ELEVENLABS_API_KEY. With `engine: 'assemblyai'` it is a temporary
 * AssemblyAI streaming token instead (redeemable for 10 minutes; each session
 * may last 10 minutes, and AssemblyAI bills while it is open).
 */
export async function liveToken({
  env = process.env,
  fetchImpl = fetch,
  engine = 'elevenlabs',
} = {}) {
  if (engine === 'grok') return grokTicket(env)
  if (engine === 'soniox') return sonioxKey({ env, fetchImpl })
  if (engine === 'cartesia') return cartesiaToken({ env, fetchImpl })
  const assembly = engine === 'assemblyai'
  const keyVar = assembly ? 'ASSEMBLYAI_API_KEY' : 'ELEVENLABS_API_KEY'
  const key = env[keyVar]
  if (!key)
    throw Object.assign(new Error(`${keyVar} not set`), {
      status: 503,
    })
  const res = assembly
    ? await fetchImpl(
        'https://streaming.assemblyai.com/v3/token?expires_in_seconds=600&max_session_duration_seconds=600',
        { headers: { Authorization: key } }
      )
    : await fetchImpl(
        'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe',
        { method: 'POST', headers: { 'xi-api-key': key } }
      )
  if (!res.ok)
    throw Object.assign(
      new Error(
        `${assembly ? 'AssemblyAI' : 'ElevenLabs'} token failed (${res.status}): ${await errorText(res)}`
      ),
      { status: 502 }
    )
  const { token } = await res.json()
  return token
}

/**
 * Grok live goes through the relay (wsProxy.mjs), so its "token" is a
 * single-use ticket for /api/grok-live?ticket=…, valid for 10 minutes.
 * Browsers can't send the relay token on a WebSocket, so the ticket, fetched
 * with the relay token, stands in for it.
 */
const GROK_TICKET_MS = 10 * 60 * 1000
const grokTickets = new Map()

function grokTicket(env) {
  if (!env.XAI_API_KEY)
    throw Object.assign(new Error('XAI_API_KEY not set'), { status: 503 })
  const now = Date.now()
  for (const [t, at] of grokTickets)
    if (now - at > GROK_TICKET_MS) grokTickets.delete(t)
  const ticket = randomBytes(24).toString('hex')
  grokTickets.set(ticket, now)
  return ticket
}

/** Spends a ticket; true if it was issued and is still fresh. */
export function useGrokTicket(ticket) {
  const at = grokTickets.get(ticket)
  grokTickets.delete(ticket)
  return at !== undefined && Date.now() - at <= GROK_TICKET_MS
}

/**
 * Soniox live: a temporary key (valid 60 s, enough to open the socket) lets
 * the browser stream straight to Soniox without seeing SONIOX_API_KEY.
 */
export async function sonioxKey({ env = process.env, fetchImpl = fetch } = {}) {
  if (!env.SONIOX_API_KEY)
    throw Object.assign(new Error('SONIOX_API_KEY not set'), { status: 503 })
  const res = await fetchImpl(
    'https://api.soniox.com/v1/auth/temporary-api-key',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SONIOX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        usage_type: 'transcribe_websocket',
        expires_in_seconds: 60,
      }),
    }
  )
  if (!res.ok)
    throw Object.assign(
      new Error(
        `Soniox key failed (${res.status}): ${await errorText(res)}`
      ),
      { status: 502 }
    )
  const { api_key } = await res.json()
  return api_key
}

/**
 * Cartesia live: an access token (valid 10 minutes, speech-to-text only)
 * lets the browser stream straight to Cartesia without CARTESIA_API_KEY.
 */
export const CARTESIA_VERSION = '2026-08-14'
export async function cartesiaToken({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  if (!env.CARTESIA_API_KEY)
    throw Object.assign(new Error('CARTESIA_API_KEY not set'), { status: 503 })
  const res = await fetchImpl('https://api.cartesia.ai/access-token', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CARTESIA_API_KEY}`,
      'Cartesia-Version': CARTESIA_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ grants: { stt: true }, expires_in: 600 }),
  })
  if (!res.ok)
    throw Object.assign(
      new Error(
        `Cartesia token failed (${res.status}): ${await errorText(res)}`
      ),
      { status: 502 }
    )
  const { token } = await res.json()
  return token
}

/**
 * P's dictionary (copied from Aqua, one entry per line; "a, b" lines give
 * each term). Soniox and Cartesia get it with their keys; the browser fits
 * it to each engine's limit.
 */
let dictionary
export function dictionaryTerms(
  file = fileURLToPath(new URL('./dictionary.txt', import.meta.url))
) {
  if (dictionary) return dictionary
  let lines = []
  try {
    lines = readFileSync(file, 'utf8').split('\n')
  } catch {
    // No dictionary shipped
  }
  const seen = new Set()
  dictionary = []
  for (const line of lines)
    // Commas split terms, except inside brackets: "Services (ClusterIP, …)"
    for (const raw of line.split(/,(?![^(]*\))/)) {
      const term = raw.replace(/\s+/g, ' ').replace(/[.:]$/, '').trim()
      if (!term || seen.has(term.toLowerCase())) continue
      seen.add(term.toLowerCase())
      dictionary.push(term)
    }
  return dictionary
}

/** The engine a live-token request asks for: `{"engine":"assemblyai"}`. */
function liveTokenEngine(body) {
  try {
    const engine = JSON.parse(body.toString('utf8')).engine
    return ['assemblyai', 'grok', 'soniox', 'cartesia'].includes(engine)
      ? engine
      : 'elevenlabs'
  } catch {
    return 'elevenlabs'
  }
}

/**
 * Dictation: your own recorded voice (16 kHz mono WAV) goes to Aqua's
 * dictation route with AQUA_API_KEY, so Aqua applies your dictionary,
 * replacements and custom instructions, as its Mac app does. Returns the
 * final text.
 */
export async function dictate(audio, { env = process.env, fetchImpl = fetch, signal } = {}) {
  const key = env.AQUA_API_KEY
  if (!key)
    throw Object.assign(new Error('AQUA_API_KEY not set'), { status: 503 })
  const form = new FormData()
  form.append('audio', audio, 'dictation.wav')
  // Saves Aqua detecting the language
  form.append('language', 'en')
  const res = await fetchImpl('https://api.aquavoice.com/v1/dictations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal,
  })
  if (!res.ok)
    throw Object.assign(
      new Error(`Aqua failed (${res.status}): ${await errorText(res)}`),
      { status: 502 }
    )
  const body = await res.json()
  return String(body.text ?? body.raw_text ?? '')
}

/**
 * Speaker clip log: the browser reports each clip it judged (text, verdict,
 * timings, notes) so it shows in Railway's logs next to the timings. One line,
 * capped, so a bad request can't flood the log.
 */
export function speakerLogLine(body) {
  let line = ''
  try {
    line = String(JSON.parse(body.toString('utf8')).line ?? '')
  } catch {
    return null
  }
  line = line.replace(/\s+/g, ' ').trim().slice(0, 6000)
  return line ? `speaker ${line}` : null
}

/**
 * Logged Auto dictations (each engine's text) for Settings > Dictation judge
 * test. Served behind the relay token, not bundled, since they are interviews.
 */
export function judgeSamples(
  file = fileURLToPath(new URL('./judge-samples.json', import.meta.url))
) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Clip too large'), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

export function createRelay(options = {}) {
  const server = createServer(async (req, res) => {
    if (
      req.url !== '/api/transcribe' &&
      req.url !== '/api/live-token' &&
      req.url !== '/api/speaker-log' &&
      req.url !== '/api/judge-samples' &&
      req.url !== '/api/dictate'
    )
      return send(res, 404, { error: 'Not found' })
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
    if (req.url === '/api/judge-samples')
      return send(res, 200, judgeSamples())
    if (req.url === '/api/speaker-log') {
      try {
        const line = speakerLogLine(await readBody(req))
        if (!line) return send(res, 400, { error: 'No line' })
        console.log(line)
        res.writeHead(204).end()
      } catch (err) {
        send(res, err.status ?? 400, { error: err.message })
      }
      return
    }
    if (req.url === '/api/dictate') {
      const started = Date.now()
      try {
        const body = await readBody(req)
        const form = await new Request('http://relay/', {
          method: 'POST',
          headers: { 'content-type': req.headers['content-type'] ?? '' },
          body,
        }).formData()
        const audio = form.get('audio')
        if (!audio || typeof audio === 'string')
          return send(res, 400, { error: 'No audio file' })
        const abort = AbortSignal.timeout(ENGINE_TIMEOUT_MS)
        const text = await dictate(audio, { ...options, signal: abort })
        console.log(
          `dictation ${(audio.size / 1024).toFixed(0)} KB: ${text.length} chars in ${Date.now() - started} ms`
        )
        return send(res, 200, { text })
      } catch (err) {
        console.log(`dictation failed in ${Date.now() - started} ms: ${err.message}`)
        return send(res, err.status ?? 400, { error: err.message })
      }
    }
    if (req.url === '/api/live-token') {
      const started = Date.now()
      let engine = 'elevenlabs'
      try {
        engine = liveTokenEngine(await readBody(req))
        const token = await liveToken({ ...options, engine })
        console.log(`live token ${engine} ${Date.now() - started} ms`)
        // Soniox and Cartesia are sent the dictionary as key terms
        if (engine === 'soniox' || engine === 'cartesia')
          return send(res, 200, { token, terms: dictionaryTerms() })
        return send(res, 200, { token })
      } catch (err) {
        console.log(`live token ${engine} failed: ${err.message}`)
        return send(res, err.status ?? 502, { error: err.message })
      }
    }
    try {
      const body = await readBody(req)
      const form = await new Request('http://relay/', {
        method: 'POST',
        headers: { 'content-type': req.headers['content-type'] ?? '' },
        body,
      }).formData()
      const file = form.get('file')
      if (!file || typeof file === 'string')
        return send(res, 400, { error: 'No audio file' })
      // The browser can ask for a subset (e.g. "elevenlabs" when the user
      // prefers speed over the two-engine comparison)
      const only = form.get('engines')
      const all = options.engines ?? ENGINES
      const wanted =
        typeof only === 'string' && only.trim()
          ? all.filter((e) => only.split(',').includes(e.name))
          : all
      // A race: return once this many engines have answered
      const need = Number(form.get('need'))
      // The browser can shorten the wait for the second engine (never longer)
      const wait = Number(form.get('wait_ms'))
      const results = await transcribeAll(file, {
        ...options,
        engines: wanted.length ? wanted : all,
        ...(Number.isInteger(need) && need > 0 ? { need } : {}),
        ...(Number.isFinite(wait) && wait >= 0 && form.get('wait_ms') !== null
          ? {
              waitMs: Math.min(wait, options.waitMs ?? SECOND_ENGINE_WAIT_MS),
            }
          : {}),
      })
      // One line per clip, so slow or failing engines show in Railway's logs
      console.log(clipLogLine(file.size, results))
      const status = results.some((r) => r.ok)
        ? 200
        : results.every((r) => r.off)
          ? 503
          : 502
      send(res, status, { results })
    } catch (err) {
      send(res, err.status ?? 400, { error: err.message })
    }
  })
  // Grok live: the browser's WebSocket is piped to xAI (see wsProxy.mjs)
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://relay')
    if (url.pathname !== '/api/grok-live') return socket.destroy()
    if (!useGrokTicket(url.searchParams.get('ticket') ?? '')) {
      console.log('grok live refused: bad or used ticket')
      return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
    }
    const client = acceptWebSocket(req, socket, head)
    const keyterms = cleanKeyterms(url.searchParams.getAll('keyterm'))
    if (client) grokLive(client, { ...options, keyterms })
  })
  return server
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.RELAY_PORT ?? 3001)
  createRelay().listen(port, '127.0.0.1', () =>
    console.log(`transcription relay on 127.0.0.1:${port}`)
  )
}
