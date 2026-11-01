import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, flushAll, stateDir } from './persist.mjs'
import { createMirrorHub, LINK_TTL_MS } from './mirror.mjs'
import { checkCode, newCode, persistAuth, resetCodes } from './auth.mjs'

const tempDir = () => mkdtempSync(join(tmpdir(), 'relay-state-'))

// Collects warnings instead of printing them
function quietLogger() {
  const warned = []
  const logger = {
    warn: (msg, fields) => warned.push({ msg, ...fields }),
    info() {},
    error() {},
    debug() {},
  }
  return { logger, warned }
}

function fakeSocket() {
  const ws = {
    got: [],
    closed: null,
    send(data) {
      ws.got.push(JSON.parse(data))
    },
    close(code) {
      ws.closed = code
    },
    onmessage: () => {},
    onclose: () => {},
  }
  return ws
}

// A link's viewer typing the code and its app letting it in; its ticket
function letIn(app, viewer) {
  viewer.onmessage(JSON.stringify({ t: 'code', code: '4821' }))
  const knock = app.got.filter((m) => m.t === 'knock').at(-1)
  app.onmessage(JSON.stringify({ t: 'admit', to: knock.from }))
  return viewer.got.find((m) => m.t === 'admitted').ticket
}

const LINK = 'P'.repeat(24)
const ENDED = 'E'.repeat(24)

beforeEach(() => {
  persistAuth('')
  resetCodes()
})

test('STATE_DIR unset: persistence is off and nothing is written', () => {
  assert.equal(stateDir({}), '')
  assert.equal(stateDir({ STATE_DIR: '  ' }), '')
  assert.equal(stateDir({ STATE_DIR: '/data/relay' }), '/data/relay')
  const store = createStore({ dir: '', file: 'x.json', snapshot: () => ({}) })
  assert.equal(store.enabled, false)
  assert.equal(store.load(), null)
  store.changed()
  store.flush()

  // A hub without a stateDir starts empty every time
  let t = 1_000_000
  const now = () => t
  const hub = createMirrorHub({ now })
  hub.join(fakeSocket(), 'send', { link: LINK, born: t })
  hub.flush()
  assert.equal(createMirrorHub({ now }).isLink(LINK), false)
})

test('writes are debounced, atomic and 0600', async () => {
  const dir = join(tempDir(), 'nested')
  let state = { n: 0 }
  const store = createStore({
    dir,
    file: 's.json',
    snapshot: () => state,
    delayMs: 30,
  })
  store.changed()
  state = { n: 1 }
  store.changed()
  assert.equal(existsSync(join(dir, 's.json')), false, 'not written yet')
  await new Promise((r) => setTimeout(r, 80))
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 's.json'), 'utf8')), {
    n: 1,
  })
  assert.equal(statSync(join(dir, 's.json')).mode & 0o777, 0o600)
  // flush writes at once; no temp files are left behind
  state = { n: 2 }
  store.changed()
  flushAll()
  assert.deepEqual(store.load(), { n: 2 })
  assert.deepEqual(readdirSync(dir), ['s.json'])
  store.close()
})

test('a corrupt or missing file is ignored with a warning', () => {
  const dir = tempDir()
  const { logger, warned } = quietLogger()
  const missing = createStore({ dir, file: 'none.json', snapshot: () => ({}), logger })
  assert.equal(missing.load(), null)
  assert.equal(warned.length, 0, 'a missing file is just a first start')

  writeFileSync(join(dir, 'mirror.json'), '{"links": [[')
  let t = 1_000_000
  const hub = createMirrorHub({ now: () => t, stateDir: dir, logger })
  assert.equal(hub.isLink(LINK), false)
  assert.equal(warned.at(-1).msg, 'persist: corrupt state file ignored')
  // and it still works, overwriting the bad file
  hub.join(fakeSocket(), 'send', { link: LINK, born: t })
  hub.flush()
  assert.ok(Array.isArray(JSON.parse(readFileSync(join(dir, 'mirror.json'))).links))
  hub.close()

  writeFileSync(join(dir, 'auth.json'), 'not json')
  persistAuth(dir, { logger })
  assert.equal(warned.at(-1).msg, 'persist: corrupt state file ignored')
  assert.equal(checkCode('123456'), 'expired')
})

test('mirror links, tickets and ended secrets survive a restart', () => {
  const dir = tempDir()
  let t = 1_000_000
  const now = () => t
  const hub = createMirrorHub({ now, stateDir: dir })
  const app = fakeSocket()
  hub.join(app, 'send', { link: LINK, born: t })
  const viewer = fakeSocket()
  hub.join(viewer, 'view', { link: LINK })
  const ticket = letIn(app, viewer)
  app.onmessage(
    JSON.stringify({ t: 'snap', title: 'Secret plans', msgs: [] })
  )
  // Another link, ended ("New link")
  const other = fakeSocket()
  hub.join(other, 'send', { link: ENDED, born: t })
  other.onmessage(JSON.stringify({ t: 'revoke', link: ENDED }))
  assert.equal(hub.isLink(ENDED), false)
  hub.flush() // SIGTERM
  hub.close()

  // Only times and tickets are saved, never the conversation
  const raw = readFileSync(join(dir, 'mirror.json'), 'utf8')
  assert.ok(!raw.includes('Secret plans'))
  assert.equal(statSync(join(dir, 'mirror.json')).mode & 0o777, 0o600)

  // The new process: the link is still open (its app was live, so it gets
  // the grace period) and the viewer's ticket still lets it straight in
  t += 60_000
  const again = createMirrorHub({ now, stateDir: dir })
  assert.equal(again.isLink(LINK), true)
  assert.equal(again.ticketOk(LINK, ticket), true)
  assert.equal(again.ticketOk(LINK, 'forged'), false)
  const back = fakeSocket()
  again.join(back, 'view', { link: LINK, ticket })
  assert.equal(back.got.find((m) => m.t === 'admitted')?.ticket, ticket)
  assert.equal(back.got.some((m) => m.t === 'gate'), false)
  // The app reconnects and its next snap rebuilds the channel
  const app2 = fakeSocket()
  again.join(app2, 'send', { link: LINK, born: 1 })
  app2.onmessage(JSON.stringify({ t: 'snap', title: 'Back', msgs: [] }))
  assert.equal(back.got.filter((m) => m.t === 'snap').at(-1).title, 'Back')
  // An ended link stays ended
  assert.equal(again.isLink(ENDED), false)
  const stale = fakeSocket()
  again.join(stale, 'send', { link: ENDED, born: t })
  assert.equal(again.isLink(ENDED), false)
  again.close()
})

test('expired links and ended secrets are dropped on load', () => {
  const dir = tempDir()
  let t = 5_000_000
  const now = () => t
  writeFileSync(
    join(dir, 'mirror.json'),
    JSON.stringify({
      links: [
        // past its grace period
        ['A'.repeat(24), { until: t - 1, born: t - 1000, tickets: ['x'], wrong: 0 }],
        // older than 90 minutes
        ['B'.repeat(24), { until: t + 9e6, born: t - LINK_TTL_MS, tickets: [], wrong: 0 }],
        // not a link secret
        ['short', { until: t + 1000, born: t - 1000, tickets: [], wrong: 0 }],
        ['C'.repeat(24), { until: t + 1000, born: t - 1000, tickets: [], wrong: 3 }],
      ],
      dead: [
        ['D'.repeat(24), t - 1],
        ['F'.repeat(24), t + 1000],
      ],
    })
  )
  const hub = createMirrorHub({ now, stateDir: dir })
  assert.equal(hub.isLink('A'.repeat(24)), false)
  assert.equal(hub.isLink('B'.repeat(24)), false)
  assert.equal(hub.isLink('C'.repeat(24)), true)
  assert.equal(hub.stats.links, 1)
  // The forgotten ended secret can be opened again; the kept one can't
  hub.join(fakeSocket(), 'send', { link: 'D'.repeat(24), born: t })
  assert.equal(hub.isLink('D'.repeat(24)), true)
  hub.join(fakeSocket(), 'send', { link: 'F'.repeat(24), born: t })
  assert.equal(hub.isLink('F'.repeat(24)), false)
  hub.close()
})

test('login limits and the pending code survive a restart, never the code', () => {
  const dir = tempDir()
  const t = Date.now()
  persistAuth(dir, { now: t })
  const code = newCode(t)
  assert.equal(checkCode('x', t), 'wrong')
  flushAll()
  const raw = readFileSync(join(dir, 'auth.json'), 'utf8')
  assert.ok(!raw.includes(code), 'the code itself is never saved')
  assert.equal(JSON.parse(raw).pending.tries, 1)
  assert.equal(statSync(join(dir, 'auth.json')).mode & 0o777, 0o600)

  // The new process
  persistAuth(dir, { now: t + 1000 })
  assert.equal(newCode(t + 1000), 'wait', 'the ask limit is kept')
  assert.equal(checkCode(code, t + 1000), 'ok', 'the emailed code still works')
})

test('an expired code and old asks are dropped on load', () => {
  const dir = tempDir()
  const t = Date.now()
  writeFileSync(
    join(dir, 'auth.json'),
    JSON.stringify({
      pending: { hash: 'a'.repeat(64), exp: t - 1, tries: 0 },
      asks: [t - 3_700_000, t - 3_000_000, 'x'],
    })
  )
  persistAuth(dir, { now: t })
  assert.equal(checkCode('123456', t), 'expired')
  // Of the asks only one is within the hour: four more codes are allowed
  for (let i = 0; i < 4; i++)
    assert.match(newCode(t + i * 31_000), /^\d{6}$/)
  assert.equal(newCode(t + 4 * 31_000), 'limit')
  persistAuth('')
})
