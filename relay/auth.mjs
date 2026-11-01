// Site login: the whole site sits behind a 6-digit code emailed to
// LOGIN_EMAIL (sent through Resend with RESEND_API_KEY). nginx asks
// /auth/check before serving anything; a signed cookie keeps a browser
// signed in. The session rolls: it lasts SESSION_DAYS (default 30) since the
// browser was last seen, and /auth/check re-issues the cookie once less than
// half of that is left. Without LOGIN_EMAIL nobody can sign in, so a missing
// variable locks the site instead of opening it. In production
// (NODE_ENV=production) AUTH_SECRET, at least 32 characters, must be set too;
// without it sign-in is refused rather than signed with a weaker key.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sameOriginRequest } from './requestSafety.mjs'
import { log } from './log.mjs'
import {
  createHmac,
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto'

export const CODE_MINUTES = 10
const CODE_TRIES = 5
const CODE_GAP_MS = 30_000
const CODES_PER_HOUR = 5
const DEFAULT_SESSION_DAYS = 30
// Browsers cap cookie lifetimes at 400 days
const MAX_SESSION_DAYS = 400
export const MIN_SECRET_LENGTH = 32
const COOKIE = 'hc_auth'
const RESEND_URL = 'https://api.resend.com/emails'
const NOT_SET_UP = "Sign-in isn't set up: LOGIN_EMAIL is missing on the server."

// One person, one pending code at a time
let pending = null
let asks = []
let fallbackSecret
let warnedSetup = false

const loginEmail = (env) => (env.LOGIN_EMAIL ?? '').trim().toLowerCase()

/** True when sign-in is set up (LOGIN_EMAIL is set). */
export const loginOn = (env = process.env) => loginEmail(env) !== ''

const production = (env) => (env.NODE_ENV ?? '').trim() === 'production'

/** How long a session lasts since the browser was last seen, in days. */
export function sessionDays(env = process.env) {
  const days = Number(env.SESSION_DAYS)
  return Number.isFinite(days) && days > 0
    ? Math.min(days, MAX_SESSION_DAYS)
    : DEFAULT_SESSION_DAYS
}

/**
 * Why sign-in can't work even though LOGIN_EMAIL is set ('' when it can): in
 * production the cookie key must be AUTH_SECRET, at least 32 characters.
 */
export function authSetupError(env = process.env) {
  if (!loginOn(env) || !production(env)) return ''
  const own = (env.AUTH_SECRET ?? '').trim()
  if (!own) return "Sign-in isn't set up: AUTH_SECRET is missing on the server."
  if (own.length < MIN_SECRET_LENGTH)
    return `Sign-in isn't set up: AUTH_SECRET on the server must be at least ${MIN_SECRET_LENGTH} characters.`
  return ''
}

/** Logs authSetupError once (at startup and on the first auth request). */
export function warnAuthSetup(env = process.env) {
  const error = authSetupError(env)
  if (error && !warnedSetup) {
    warnedSetup = true
    log.error(`login: ${error} Sign-in is refused until it is set.`)
  }
  return error
}

// Sign-in works: LOGIN_EMAIL is set and so is a usable cookie key
const authReady = (env) => loginOn(env) && authSetupError(env) === ''

// The cookie is signed with AUTH_SECRET. Outside production only, it falls
// back to a key derived from RESEND_API_KEY (stable across restarts), then to
// a random per-process key, so local runs need no setup. Changing the key
// signs every browser out.
function secret(env) {
  const own = (env.AUTH_SECRET ?? '').trim()
  if (own || production(env)) return own
  const resend = (env.RESEND_API_KEY ?? '').trim()
  if (resend)
    return createHash('sha256').update(`hc-auth:${resend}`).digest('hex')
  return (fallbackSecret ??= randomBytes(32).toString('hex'))
}

const sign = (env, exp) =>
  createHmac('sha256', secret(env))
    .update(`${exp}:${loginEmail(env)}`)
    .digest('hex')

/** A cookie value good until `exp` (ms since 1970). */
export function sessionToken(env, exp) {
  return `${exp}.${sign(env, exp)}`
}

function safeEqual(a, b) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * The remote camera's key (camera.mjs): the /mirror page's camera and the Chrome
 * extension use it instead of the login cookie, which Meet's pages can't send.
 * It changes with the cookie secret, so rotating AUTH_SECRET revokes it.
 */
export function cameraKey(env = process.env) {
  if (!authReady(env)) return ''
  return createHmac('sha256', secret(env))
    .update(`camera:${loginEmail(env)}`)
    .digest('hex')
    .slice(0, 40)
}

/** Whether `key` is the camera key (compared in constant time). */
export function cameraKeyOk(key, env = process.env) {
  const want = cameraKey(env)
  return want !== '' && typeof key === 'string' && safeEqual(key, want)
}

// The expiry (ms) of a valid, unexpired session cookie, else 0
function sessionExp(cookieHeader, env, now) {
  if (!authReady(env)) return 0
  const m = (cookieHeader ?? '').match(
    /(?:^|;\s*)hc_auth=(\d+)\.([a-f0-9]{64})(?=;|$)/
  )
  if (!m) return 0
  const exp = Number(m[1])
  return exp > now && safeEqual(m[2], sign(env, exp)) ? exp : 0
}

/** Whether the request carries a valid, unexpired session cookie. */
export function signedIn(cookieHeader, env = process.env, now = Date.now()) {
  return sessionExp(cookieHeader, env, now) > 0
}

/** A fresh session cookie (Set-Cookie value) good for the whole window. */
export function sessionCookie(env = process.env, now = Date.now()) {
  const windowMs = sessionDays(env) * 86_400_000
  return cookie(
    sessionToken(env, now + windowMs),
    Math.round(windowMs / 1000)
  )
}

/**
 * For a signed-in request, the cookie to send back when the session should
 * roll forward: less than half the window is left, or (a cookie from before
 * the window shrank) more than the whole window. '' when there's nothing to
 * renew; null when not signed in.
 */
export function renewedCookie(
  cookieHeader,
  env = process.env,
  now = Date.now()
) {
  const exp = sessionExp(cookieHeader, env, now)
  if (!exp) return null
  const windowMs = sessionDays(env) * 86_400_000
  const left = exp - now
  return left < windowMs / 2 || left > windowMs ? sessionCookie(env, now) : ''
}

const cookie = (value, maxAgeSec) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`

const hashCode = (code) =>
  createHash('sha256').update(`hc-code:${code}`).digest('hex')

/** Starts a new code; returns it, or 'wait' / 'limit' when asked too often. */
export function newCode(now = Date.now()) {
  asks = asks.filter((t) => now - t < 3_600_000)
  if (asks.length && now - asks.at(-1) < CODE_GAP_MS) return 'wait'
  if (asks.length >= CODES_PER_HOUR) return 'limit'
  asks.push(now)
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  pending = { hash: hashCode(code), exp: now + CODE_MINUTES * 60_000, tries: 0 }
  return code
}

/** 'ok' spends the code; anything else is a wrong, expired or used-up code. */
export function checkCode(code, now = Date.now()) {
  if (!pending || pending.exp < now || pending.tries >= CODE_TRIES) {
    pending = null
    return 'expired'
  }
  pending.tries++
  if (!safeEqual(hashCode(code), pending.hash)) return 'wrong'
  pending = null
  return 'ok'
}

/** For tests: forget codes and the ask history. */
export function resetCodes() {
  pending = null
  asks = []
}

async function emailCode(env, code, fetchImpl) {
  const key = (env.RESEND_API_KEY ?? '').trim()
  if (!key) throw new Error('RESEND_API_KEY not set')
  const from = (env.EMAIL_FROM ?? '').trim() || 'Hi-chat <login@hi-techie.dev>'
  const res = await fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [loginEmail(env)],
      subject: `Hi-chat code: ${code}`,
      text: `Your Hi-chat sign-in code is ${code}. It works for ${CODE_MINUTES} minutes.\n\nIf you didn't ask for it, ignore this email.`,
      html: `<p>Your Hi-chat sign-in code is</p><p style="font-size:28px;font-weight:600;letter-spacing:4px">${code}</p><p>It works for ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email.</p>`,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}`)
}

// "Info.hi-techie@gmail.com" shows as "in***@gmail.com"
const masked = (email) => email.replace(/^(.{2}).*@/, '$1***@')

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1000) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/**
 * Handles /login and /auth/*; returns false for any other path.
 * nginx sends /auth/check for every request, with the browser's cookies.
 */
export async function handleAuth(
  req,
  res,
  env = process.env,
  fetchImpl = fetch,
  // The request's logger (with its rid); never given the code or cookie
  logger = log
) {
  const path = (req.url ?? '').split('?')[0]
  if (
    path.startsWith('/auth/') &&
    req.method === 'POST' &&
    !sameOriginRequest(req)
  ) {
    json(res, 403, { error: 'Cross-origin request refused' })
    return true
  }
  const setupError = warnAuthSetup(env)
  if (path === '/auth/check') {
    const renewed = renewedCookie(req.headers.cookie, env)
    if (renewed === null) res.writeHead(401).end()
    else res.writeHead(204, renewed ? { 'Set-Cookie': renewed } : {}).end()
    return true
  }
  if (path === '/login' && req.method === 'GET') {
    if (signedIn(req.headers.cookie, env)) {
      res.writeHead(302, { Location: '/' }).end()
      return true
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(loginPage(masked(loginEmail(env))))
    return true
  }
  if (path === '/auth/code' && req.method === 'POST') {
    if (!loginOn(env)) return (json(res, 503, { error: NOT_SET_UP }), true)
    if (setupError) return (json(res, 503, { error: setupError }), true)
    const code = newCode()
    if (code === 'wait')
      return (
        json(res, 429, {
          error:
            'A code was just sent. Wait 30 seconds before asking for another.',
        }),
        true
      )
    if (code === 'limit')
      return (
        json(res, 429, { error: 'Too many codes this hour. Try again later.' }),
        true
      )
    try {
      await emailCode(env, code, fetchImpl)
      logger.info('login: code sent')
      return (json(res, 200, { ok: true, minutes: CODE_MINUTES }), true)
    } catch (err) {
      logger.warn('login: code email failed', { error: err.message })
      return (
        json(res, 502, {
          error: "Couldn't send the email. Try again in a minute.",
        }),
        true
      )
    }
  }
  if (path === '/auth/verify' && req.method === 'POST') {
    if (!loginOn(env)) return (json(res, 503, { error: NOT_SET_UP }), true)
    if (setupError) return (json(res, 503, { error: setupError }), true)
    const body = await readJson(req)
    const r = checkCode(String(body?.code ?? '').replace(/\D/g, ''))
    if (r !== 'ok') {
      logger.info(`login: ${r} code`)
      return (
        json(res, 401, {
          error:
            "That code isn't right or has expired. Check the latest email, or ask for a new code.",
        }),
        true
      )
    }
    logger.info('login: signed in')
    return (
      json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(env) }),
      true
    )
  }
  if (path === '/auth/logout' && req.method === 'POST') {
    return (json(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) }), true)
  }
  return false
}

// The hi-techie.dev logo, inlined so the login page needs nothing behind the login
let logo
function logoTag() {
  try {
    logo ??= readFileSync(
      fileURLToPath(new URL('./logo.png', import.meta.url))
    ).toString('base64')
  } catch {
    logo = ''
  }
  return logo
    ? `<img style="border-radius:14px" src="data:image/png;base64,${logo}" width="56" height="56" alt="">`
    : ''
}

function loginPage(email) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Hi-chat · Sign in</title>
<style>
  :root { color-scheme: light dark; --bg:#f4f4f2; --card:#fff; --fg:#18181b; --muted:#6b6b70; --line:#e2e2e0; --accent:#5b50e6; --err:#c62828; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111113; --card:#1a1a1d; --fg:#ececef; --muted:#9a9aa0; --line:#2e2e33; --accent:#6c63ff; --err:#ef6b6b; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; padding:16px; }
  main { width:100%; max-width:360px; background:var(--card); border:1px solid var(--line); border-radius:16px; padding:32px 28px; text-align:center; }
  h1 { font-size:20px; margin:16px 0 4px; }
  p { color:var(--muted); margin:0 0 20px; }
  input { width:100%; font-size:24px; letter-spacing:8px; text-align:center; padding:10px; border:1px solid var(--line); border-radius:10px; background:transparent; color:var(--fg); }
  button { width:100%; margin-top:12px; padding:11px; font-size:15px; font-weight:600; border:0; border-radius:10px; background:var(--accent); color:#fff; cursor:pointer; }
  button:disabled { opacity:.6; cursor:default; }
  .link { background:none; color:var(--accent); font-weight:500; }
  .msg { min-height:22px; margin-top:12px; font-size:14px; }
  .err { color:var(--err); }
  [hidden] { display:none; }
</style>
</head>
<body>
<main>
  ${logoTag()}
  <h1>Sign in to Hi-chat</h1>
  <p id="hint">We'll email a 6-digit code to ${email}.</p>
  <button id="send" type="button">Send code</button>
  <form id="verify" hidden>
    <input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="6-digit code">
    <button id="go" type="submit">Sign in</button>
    <button id="again" class="link" type="button">Send a new code</button>
  </form>
  <div id="msg" class="msg" role="status"></div>
</main>
<script>
  const $ = (id) => document.getElementById(id)
  const say = (text, err) => { $('msg').textContent = text; $('msg').className = 'msg' + (err ? ' err' : '') }
  async function post(path, body) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.')
    return data
  }
  async function sendCode(btn) {
    btn.disabled = true; say('Sending…')
    try {
      await post('/auth/code')
      $('send').hidden = true; $('verify').hidden = false
      $('hint').textContent = 'Enter the code we emailed to ${email}.'
      say('Code sent. It works for 10 minutes.'); $('code').focus()
    } catch (e) { say(e.message, true) }
    btn.disabled = false
  }
  $('send').onclick = () => sendCode($('send'))
  $('again').onclick = () => sendCode($('again'))
  $('verify').onsubmit = async (e) => {
    e.preventDefault(); $('go').disabled = true; say('Checking…')
    try { await post('/auth/verify', { code: $('code').value }); location.replace('/') }
    catch (err) { say(err.message, true); $('go').disabled = false }
  }
  $('code').oninput = () => { $('code').value = $('code').value.replace(/\\D/g, ''); if ($('code').value.length === 6) $('verify').requestSubmit() }
</script>
</body>
</html>`
}
