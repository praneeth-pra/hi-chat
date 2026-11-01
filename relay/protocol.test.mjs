import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MIRROR_CLOSE_LINK_ENDED,
  MIRROR_CLOSE_VERSION_UNSUPPORTED,
  MIRROR_KINDS,
  MIRROR_PROTOCOL_VERSION,
  MIRROR_SEQUENCED_KINDS,
  versionOk,
} from './protocol.mjs'
import { LINK_ENDED } from './mirror.mjs'

// core's definition, read as text (the relay doesn't build TypeScript)
const core = readFileSync(
  new URL('../core/src/types/mirror/index.ts', import.meta.url),
  'utf8'
)

const constant = (name) => {
  const m = core.match(new RegExp(`export const ${name} = (\\d+)\\b`))
  assert.ok(m, `core defines ${name}`)
  return Number(m[1])
}

const list = (name) => {
  const m = core.match(
    new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`)
  )
  assert.ok(m, `core defines ${name}`)
  // Strings only, comments skipped
  const body = m[1].replace(/\/\/.*$/gm, '')
  return [...body.matchAll(/'([^']+)'/g)].map((x) => x[1])
}

test('the protocol version matches core', () => {
  assert.equal(MIRROR_PROTOCOL_VERSION, constant('MIRROR_PROTOCOL_VERSION'))
})

test('the close codes match core', () => {
  assert.equal(MIRROR_CLOSE_LINK_ENDED, constant('MIRROR_CLOSE_LINK_ENDED'))
  assert.equal(
    MIRROR_CLOSE_VERSION_UNSUPPORTED,
    constant('MIRROR_CLOSE_VERSION_UNSUPPORTED')
  )
  assert.equal(LINK_ENDED, MIRROR_CLOSE_LINK_ENDED)
})

test('the message kinds match core', () => {
  assert.deepEqual([...MIRROR_KINDS], list('MIRROR_KINDS'))
  assert.deepEqual(
    [...MIRROR_SEQUENCED_KINDS],
    list('MIRROR_SEQUENCED_KINDS')
  )
  for (const k of MIRROR_SEQUENCED_KINDS) assert.ok(MIRROR_KINDS.includes(k))
})

test('every kind core types as a message is a known kind', () => {
  // Each `t: '<kind>'` in core's message types
  const typed = new Set([...core.matchAll(/\bt: '([a-z]+)'/g)].map((x) => x[1]))
  assert.deepEqual([...typed].sort(), [...MIRROR_KINDS].sort())
})

test('versionOk: missing or not newer is fine, newer is not', () => {
  for (const v of [undefined, null, '', 1, '1', 0, 'x'])
    assert.equal(versionOk(v), true, String(v))
  for (const v of [2, '2', MIRROR_PROTOCOL_VERSION + 1])
    assert.equal(versionOk(v), false, String(v))
})
