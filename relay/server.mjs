// Transcription relay: the browser uploads each clip once to
// /api/transcribe; this sends it to every engine with a key at the same time,
// adding the keys (ELEVENLABS_API_KEY, XAI_API_KEY) so
// they never reach the browser. nginx lets only signed-in browsers through
// (the site login, auth.mjs).
//
// Once one engine answers, the others get SECOND_ENGINE_WAIT_MS more (the
// browser can ask for less); whatever has arrived by then is returned in
// ENGINES order. In a race (`need`), it returns as soon as that many answered.

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import {
  acceptWebSocket,
  cleanKeyterms,
  grokLive,
  museLive,
} from './wsProxy.mjs'
import { cameraKey, cameraKeyOk, handleAuth } from './auth.mjs'
import { sameOriginRequest } from './requestSafety.mjs'
import { searchWeb, warmSearch } from './search.mjs'
import { createMirrorHub } from './mirror.mjs'
import { createCameraHub } from './camera.mjs'

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
    // Dictation races require usable speech, not merely a successful request.
    requireText = false,
    timeoutMs = ENGINE_TIMEOUT_MS,
    signal,
  } = {}
) {
  return new Promise((resolve) => {
    const started = Date.now()
    const abort = new AbortController()
    let timeout
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
    const usable = (r) => r?.ok && (!requireText || !!r.text?.trim())

    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearTimeout(timeout)
      signal?.removeEventListener('abort', finish)
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

    timeout = setTimeout(finish, timeoutMs)
    signal?.addEventListener('abort', finish, { once: true })
    if (running === 0 || signal?.aborted) return finish()

    engines.forEach((engine, i) => {
      if (results[i]) return
      Promise.resolve()
        .then(() => {
          if (abort.signal.aborted) throw abort.signal.reason
          return engine.run(file, env[engine.keyVar], abort.signal, fetchImpl)
        })
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
          if (running === 0 || results.filter(usable).length >= need) finish()
          else if (!timer && results.some(usable))
            timer = setTimeout(finish, waitMs)
        })
    })
  })
}

/**
 * One line per clip, so slow or failing engines show in Railway's logs. Each
 * engine's own words are included so their accuracy can be compared.
 */
export function clipLogLine(size, results, includeText = false) {
  return (
    `clip ${size} B: ` +
    results
      .map((r) =>
        r.off
          ? `${r.name} off`
          : r.ok
            ? `${r.name} ${r.ms} ms ${includeText ? JSON.stringify(String(r.text).slice(0, 400)) : `${String(r.text).length} chars`}`
            : `${r.name} failed after ${r.ms} ms (${r.error})`
      )
      .join(', ')
  )
}

/**
 * Live mode: a single-use ElevenLabs token (valid 15 minutes) lets the browser
 * stream audio straight to ElevenLabs' realtime model without ever seeing
 * ELEVENLABS_API_KEY.
 */
export async function liveToken({
  env = process.env,
  fetchImpl = fetch,
  engine = 'elevenlabs',
} = {}) {
  if (engine === 'grok')
    return liveTicket('grok', env.XAI_API_KEY, 'XAI_API_KEY')
  if (engine === 'muse')
    return liveTicket('muse', env.META_API_KEY, 'META_API_KEY')
  if (engine === 'soniox') return sonioxKey({ env, fetchImpl })
  if (engine === 'cartesia') return cartesiaToken({ env, fetchImpl })
  const key = env.ELEVENLABS_API_KEY
  if (!key)
    throw Object.assign(new Error('ELEVENLABS_API_KEY not set'), {
      status: 503,
    })
  const res = await fetchImpl(
    'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe',
    {
      method: 'POST',
      headers: { 'xi-api-key': key },
      signal: AbortSignal.timeout(15_000),
    }
  )
  if (!res.ok)
    throw Object.assign(
      new Error(
        `ElevenLabs token failed (${res.status}): ${await errorText(res)}`
      ),
      { status: 502 }
    )
  const { token } = await res.json()
  return token
}

/**
 * Grok and Muse live go through the relay (wsProxy.mjs), so their "token" is
 * a single-use ticket for /api/grok-live or /api/muse-live?ticket=…, valid
 * for 10 minutes. The ticket, fetched by a signed-in browser, lets the
 * WebSocket through to the relay.
 */
const TICKET_MS = 10 * 60 * 1000
const tickets = new Map()

function liveTicket(engine, key, keyName) {
  if (!key)
    throw Object.assign(new Error(`${keyName} not set`), { status: 503 })
  const now = Date.now()
  for (const [t, { at }] of tickets) if (now - at > TICKET_MS) tickets.delete(t)
  const ticket = randomBytes(24).toString('hex')
  tickets.set(ticket, { engine, at: now })
  return ticket
}

/** Spends a ticket; true if it was issued for `engine` and is still fresh. */
export function useLiveTicket(ticket, engine) {
  const issued = tickets.get(ticket)
  tickets.delete(ticket)
  return (
    issued !== undefined &&
    issued.engine === engine &&
    Date.now() - issued.at <= TICKET_MS
  )
}

export const useGrokTicket = (ticket) => useLiveTicket(ticket, 'grok')

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
      signal: AbortSignal.timeout(15_000),
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
      new Error(`Soniox key failed (${res.status}): ${await errorText(res)}`),
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
    signal: AbortSignal.timeout(15_000),
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
 * P's dictionary (one entry per line; "a, b" lines give
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
  // Commas split terms, except inside brackets: "Services (ClusterIP, …)"
  for (const line of lines)
    for (const raw of line.split(/,(?![^(]*\))/)) {
      const term = raw.replace(/\s+/g, ' ').replace(/[.:]$/, '').trim()
      if (!term || seen.has(term.toLowerCase())) continue
      seen.add(term.toLowerCase())
      dictionary.push(term)
    }
  return dictionary
}

/** The engine a live-token request asks for: `{"engine":"soniox"}`. */
function liveTokenEngine(body) {
  try {
    const engine = JSON.parse(body.toString('utf8')).engine
    return ['grok', 'muse', 'soniox', 'cartesia'].includes(engine)
      ? engine
      : 'elevenlabs'
  } catch {
    return 'elevenlabs'
  }
}

/**
 * Speech diagnostics: the browser reports each clip it judged (text, verdict,
 * timings, notes) so it shows in Railway's logs next to the timings. One line,
 * capped, so a bad request can't flood the log.
 */
export function speechLogLine(body, includeText = false) {
  let line = ''
  try {
    line = String(JSON.parse(body.toString('utf8')).line ?? '')
  } catch {
    return null
  }
  line = line.replace(/\s+/g, ' ').trim().slice(0, 6000)
  if (!line) return null
  if (includeText) return `speech ${line}`
  // Retain numeric diagnostics; arbitrary text is never copied into default logs.
  const auto = line.match(
    /^dictation auto: sent=[\w-]+ total=\d+ms(?: [\w-]+=(?:\d+ms|none))*(?: judge=\d+ms)?(?= \||$)/
  )
  const single = line.match(
    /^dictation (?:[\w-]+|fallback \((?:live failed|live empty)\)): \d+ ms after stop, \d+ chars$/
  )
  // Speed replies: timings only, every field known.
  const speed = line.match(
    /^speed: model=(?:(?:openai_)?gpt-oss-(?:20|120)b|qwen_qwen3\.8-27b|qwen-3\.8-27b|claude-[a-z0-9.-]{1,40}|none) total=(?:\d{1,9}ms|none) first_byte=(?:\d{1,9}ms|none) first_words=(?:\d{1,9}ms|none) answer=(?:\d{1,9}ms|none) tokens=\d{1,7} route=(?:direct|server|none) hidden=(?:yes|no)$/
  )
  if (speed) return speed[0]
  // The Windows app: a shortcut that waited for its window to run it.
  const appKey = line.match(
    /^windows key: waited=\d{1,9}ms mirror=(?:off|chat|pointer)$/
  )
  if (appKey) return `speech ${appKey[0]}`
  // Allow only known diagnostic fields and values, not arbitrary key=value text.
  if (line.startsWith('accuracy:')) {
    const reason =
      '(?:invalid-json|claim-span|missing-audit|source-reference|context-reference|unsupported-claim|invalid-verdict|incomplete-response|missing-response|timeout|provider-[45]\\d\\d|provider-error)'
    const rules = {
      verdict: /^(approved|revised|uncertain|unverified|direct)$/,
      model:
        /^(?:openai_)?gpt-oss-(?:20|120)b$|^claude-(?:sonnet|haiku|opus)-[0-9.-]+$/,
      search: /^(ready|empty|unavailable|unconfigured|skipped)$/,
      sources: /^\d{1,2}$/,
      total: /^\d{1,9}ms$|^none$/,
      search_time: /^\d{1,9}ms$|^none$/,
      draft: /^\d{1,9}ms$|^none$/,
      review: /^\d{1,9}ms$|^none$/,
      first: /^\d{1,9}ms$|^none$/,
      claims: /^\d{1,5}$/,
      context_claims: /^\d{1,5}$/,
      unsupported: /^\d{1,5}$/,
      fallback: /^(none|grounded-draft|reviewer-answer)$/,
      failures: new RegExp(
        `^(?:none|(?:groq|cerebras|claude):${reason}(?:,(?:groq|cerebras|claude):${reason})*)$`
      ),
      reviewers: new RegExp(
        `^(?:none|(?:groq|cerebras|claude)(?:-repair)?:(?:cancelled|\\d{1,9}ms:(?:ok|${reason}))(?:,(?:groq|cerebras|claude)(?:-repair)?:(?:cancelled|\\d{1,9}ms:(?:ok|${reason})))*)$`
      ),
    }
    const tokens = line.slice('accuracy:'.length).trim().split(' ')
    const seen = new Set()
    if (
      tokens.length <= Object.keys(rules).length &&
      tokens.every((token) => {
        const split = token.indexOf('=')
        const key = token.slice(0, split)
        const value = token.slice(split + 1)
        if (
          !Object.hasOwn(rules, key) ||
          seen.has(key) ||
          !rules[key].test(value)
        )
          return false
        seen.add(key)
        return true
      })
    )
      return line
  }
  return `speech ${auto?.[0] ?? single?.[0] ?? 'diagnostic text omitted'}`
}

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > maxBytes) {
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
    // The site login (/login, /auth/*), see auth.mjs
    if (await handleAuth(req, res, options.env, options.fetchImpl)) return
    if (
      req.url !== '/api/transcribe' &&
      req.url !== '/api/live-token' &&
      req.url !== '/api/search' &&
      req.url !== '/api/speech-log' &&
      req.url !== '/api/camera-key'
    )
      return send(res, 404, { error: 'Not found' })
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
    if (!sameOriginRequest(req))
      return send(res, 403, { error: 'Cross-origin request refused' })
    if (req.url === '/api/search') {
      const controller = new AbortController()
      const disconnect = () => {
        if (!res.writableEnded) controller.abort()
      }
      res.on('close', disconnect)
      try {
        const body = JSON.parse(
          (await readBody(req, 16 * 1024)).toString('utf8')
        )
        if (body?.warm === true) {
          await warmSearch(options)
          if (!res.destroyed) res.writeHead(204).end()
          return
        }
        const result = await searchWeb(body.query, {
          ...options,
          signal: controller.signal,
        })
        if (!res.destroyed) send(res, 200, result)
      } catch (err) {
        if (!res.destroyed)
          send(res, err.status ?? 400, { error: 'Invalid search request' })
      } finally {
        res.off('close', disconnect)
      }
      return
    }
    // The remote camera's key, for the signed-in /mirror page (nginx checks
    // the login before this)
    if (req.url === '/api/camera-key') {
      const key = cameraKey(options.env ?? process.env)
      return key
        ? send(res, 200, { key })
        : send(res, 503, { error: 'Sign-in is not set up' })
    }
    if (req.url === '/api/speech-log') {
      try {
        const line = speechLogLine(
          await readBody(req),
          (options.env ?? process.env).SPEECH_LOG_TEXT === '1'
        )
        if (!line) return send(res, 400, { error: 'No line' })
        console.log(line)
        res.writeHead(204).end()
      } catch (err) {
        send(res, err.status ?? 400, { error: err.message })
      }
      return
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
      const disconnected = new AbortController()
      const onClose = () => {
        if (!res.writableEnded) disconnected.abort()
      }
      res.once('close', onClose)
      const results = await transcribeAll(file, {
        ...options,
        engines: wanted.length ? wanted : all,
        signal: disconnected.signal,
        requireText: form.get('require_text') === '1',
        ...(Number.isInteger(need) && need > 0 ? { need } : {}),
        ...(Number.isFinite(wait) && wait >= 0 && form.get('wait_ms') !== null
          ? {
              waitMs: Math.min(wait, options.waitMs ?? SECOND_ENGINE_WAIT_MS),
            }
          : {}),
      })
      res.removeListener('close', onClose)
      if (disconnected.signal.aborted) return
      // One line per clip, so slow or failing engines show in Railway's logs
      console.log(
        clipLogLine(
          file.size,
          results,
          (options.env ?? process.env).SPEECH_LOG_TEXT === '1'
        )
      )
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
  // Grok and Muse live: the browser's WebSocket is piped to xAI or Meta
  // (see wsProxy.mjs)
  const LIVE_PATHS = { '/api/grok-live': 'grok', '/api/muse-live': 'muse' }
  // Remote mirror (mirror.mjs): nginx lets only signed-in browsers through
  const mirror = createMirrorHub()
  // Remote camera (camera.mjs): reached from Meet tabs, so the camera key
  // stands in for the login cookie
  const camera = createCameraHub({ env: options.env ?? process.env })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://relay')
    if (url.pathname === '/api/camera') {
      const role = url.searchParams.get('role') === 'send' ? 'send' : 'view'
      // The camera key, or for sending from a mirror link (no login there),
      // the link itself while its app keeps it
      const allowed =
        cameraKeyOk(url.searchParams.get('key'), options.env ?? process.env) ||
        (role === 'send' && mirror.isLink(url.searchParams.get('link')))
      if (!allowed) return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
      const client = acceptWebSocket(req, socket, head)
      if (client) camera.join(client, role)
      return
    }
    // A mirror link, opened without login: it watches one app only, and only
    // while that app keeps the link
    if (url.pathname === '/api/mirror-link') {
      if (!sameOriginRequest(req))
        return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      const link = url.searchParams.get('link')
      if (!mirror.isLink(link))
        return socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
      const client = acceptWebSocket(req, socket, head)
      if (client) mirror.join(client, 'view', { link })
      return
    }
    if (url.pathname === '/api/mirror') {
      if (!sameOriginRequest(req))
        return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      const client = acceptWebSocket(req, socket, head)
      if (client)
        mirror.join(
          client,
          url.searchParams.get('role') === 'send' ? 'send' : 'view',
          // A sender may name its app's link, for that link's viewers
          url.searchParams.get('role') === 'send'
            ? { link: url.searchParams.get('link') ?? undefined }
            : {}
        )
      return
    }
    const engine = LIVE_PATHS[url.pathname]
    if (!engine) return socket.destroy()
    if (!sameOriginRequest(req))
      return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
    if (!useLiveTicket(url.searchParams.get('ticket') ?? '', engine)) {
      console.log(`${engine} live refused: bad or used ticket`)
      return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
    }
    const client = acceptWebSocket(req, socket, head)
    const keyterms = cleanKeyterms(url.searchParams.getAll('keyterm'))
    if (client)
      (engine === 'muse' ? museLive : grokLive)(client, {
        ...options,
        keyterms,
      })
  })
  return server
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.RELAY_PORT ?? 3001)
  createRelay().listen(port, '127.0.0.1', () =>
    console.log(`transcription relay on 127.0.0.1:${port}`)
  )
}
