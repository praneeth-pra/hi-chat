import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLogger } from './log.mjs'

const capture = () => {
  const lines = []
  const logger = createLogger({
    write: (l) => lines.push(l),
    now: () => new Date('2026-11-01T00:00:00.000Z'),
  })
  return { lines, logger, parsed: () => lines.map((l) => JSON.parse(l)) }
}

test('one JSON object per line: ts, level, msg, then fields', () => {
  const { lines, logger, parsed } = capture()
  logger.info('live token', { engine: 'soniox', ms: 12, ok: true })
  logger.error('boom')
  assert.ok(lines.every((l) => l.endsWith('\n') && !l.slice(0, -1).includes('\n')))
  assert.deepEqual(parsed(), [
    {
      ts: '2026-11-01T00:00:00.000Z',
      level: 'info',
      msg: 'live token',
      engine: 'soniox',
      ms: 12,
      ok: true,
    },
    { ts: '2026-11-01T00:00:00.000Z', level: 'error', msg: 'boom' },
  ])
  assert.deepEqual(Object.keys(parsed()[0]).slice(0, 3), ['ts', 'level', 'msg'])
})

test('levels, and a child adds its fields (rid) to every line', () => {
  const { logger, parsed } = capture()
  const child = logger.child({ rid: 'abc' })
  child.debug('a')
  child.warn('b', { n: 1 })
  assert.deepEqual(
    parsed().map((e) => [e.level, e.msg, e.rid, e.n]),
    [
      ['debug', 'a', 'abc', undefined],
      ['warn', 'b', 'abc', 1],
    ]
  )
})

test('fields cannot overwrite ts, level or msg', () => {
  const { logger, parsed } = capture()
  logger.info('real', { msg: 'fake', level: 'error', ts: 'x' })
  const [e] = parsed()
  assert.equal(e.msg, 'real')
  assert.equal(e.level, 'info')
  assert.equal(e.ts, '2026-11-01T00:00:00.000Z')
})

test('secret-looking fields are blanked; errors become their message', () => {
  const { logger, parsed } = capture()
  logger.info('x', {
    code: '123456',
    cookie: 'hc=1',
    token: 't',
    Authorization: 'Bearer k',
    text: 'what I said',
    error: new Error('nope'),
    undef: undefined,
  })
  const [e] = parsed()
  for (const k of ['code', 'cookie', 'token', 'Authorization', 'text'])
    assert.equal(e[k], '[redacted]')
  assert.equal(e.error, 'nope')
  assert.ok(!('undef' in e))
})

test('an unserializable field still logs the message', () => {
  const { logger, parsed } = capture()
  const loop = {}
  loop.loop = loop
  logger.info('still here', { loop })
  assert.equal(parsed()[0].msg, 'still here')
})
