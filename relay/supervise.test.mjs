// Runs docker/supervise.sh (the container's process supervisor) with fake
// relay and nginx commands, so restarts and signal handling are covered
// without Docker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const script = new URL('../docker/supervise.sh', import.meta.url).pathname

function fakeCommand(dir, name, body) {
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

function run(relayBody, nginxBody, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'supervise-'))
  const child = spawn('sh', [script, ...args], {
    env: {
      PATH: process.env.PATH,
      RELAY_CMD: fakeCommand(dir, 'relay', relayBody.replaceAll('$DIR', dir)),
      NGINX_ENTRYPOINT: fakeCommand(dir, 'nginx', nginxBody.replaceAll('$DIR', dir)),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d))
  const exited = new Promise((resolve) =>
    child.on('exit', (code, signal) => resolve({ code, signal, stderr })),
  )
  return { dir, child, exited, stderr: () => stderr }
}

const until = async (check, ms = 8000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

test('a crashing relay is restarted with a counted, doubling backoff', async () => {
  const s = run('exit 1', "trap 'exit 0' TERM; while :; do sleep 0.1; done")
  await until(() => s.stderr().includes('restart #2'))
  assert.match(s.stderr(), /relay exited \(status 1\) after \d+s; restart #1 in 1s/)
  assert.match(s.stderr(), /restart #2 in 2s/)
  s.child.kill('SIGTERM')
  const { code } = await s.exited
  assert.equal(code, 0)
})

test('SIGTERM reaches both nginx and the relay', async () => {
  const s = run(
    `trap 'touch $DIR/relay-term; exit 0' TERM; touch $DIR/relay-up; while :; do sleep 0.1; done`,
    `trap 'touch $DIR/nginx-term; exit 0' TERM; touch $DIR/nginx-up; while :; do sleep 0.1; done`,
  )
  await until(() => existsSync(join(s.dir, 'relay-up')) && existsSync(join(s.dir, 'nginx-up')))
  s.child.kill('SIGTERM')
  const { code, stderr } = await s.exited
  assert.equal(code, 0)
  assert.ok(existsSync(join(s.dir, 'relay-term')), 'relay got SIGTERM')
  assert.ok(existsSync(join(s.dir, 'nginx-term')), 'nginx got SIGTERM')
  assert.doesNotMatch(stderr, /restart #/)
})

test('the supervisor exits with nginx, passing on its arguments and status', async () => {
  const s = run(
    `trap 'touch $DIR/relay-term; exit 0' TERM; while :; do sleep 0.1; done`,
    `echo "$*" > $DIR/nginx-args; sleep 0.3; exit 3`,
    ['nginx', '-g', 'daemon off;'],
  )
  const { code } = await s.exited
  assert.equal(code, 3)
  assert.ok(existsSync(join(s.dir, 'relay-term')), 'relay was stopped')
  assert.equal(readFileSync(join(s.dir, 'nginx-args'), 'utf8').trim(), 'nginx -g daemon off;')
})
