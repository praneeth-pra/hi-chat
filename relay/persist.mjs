// Small JSON file store, so the relay's state outlives a restart or deploy
// without Redis. Each store is one file under STATE_DIR (on Railway, a
// volume mounted there, e.g. /data/relay). Without STATE_DIR nothing is read
// or written and the relay keeps everything in memory, as before.
//
// Writes are atomic (a temp file, then rename), debounced (one write at most
// every `delayMs` however often the state changes) and flushed on shutdown
// (flushAll, from server.mjs's SIGTERM/SIGINT handler). Files are 0600. A
// missing or corrupt file is skipped with a warning: the relay starts empty.

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { log } from './log.mjs'

const DEFAULT_DELAY_MS = 500

// Every enabled store, for flushAll
const stores = new Set()

/** The state directory from the environment, or '' (persistence off). */
export const stateDir = (env = process.env) => (env.STATE_DIR ?? '').trim()

/**
 * A store for `file` in `dir`. `snapshot()` returns the JSON-able state to
 * write. With no `dir` the store is off: load() gives null and the rest do
 * nothing.
 *   load()    the saved state, or null (none, unreadable or corrupt)
 *   changed() write soon (debounced)
 *   flush()   write now, if anything changed
 *   close()   flush and stop
 */
export function createStore({
  dir,
  file,
  snapshot,
  delayMs = DEFAULT_DELAY_MS,
  logger = log,
}) {
  if (!dir)
    return {
      enabled: false,
      load: () => null,
      changed() {},
      flush() {},
      close() {},
    }
  const path = join(dir, file)
  let timer = null
  let dirty = false

  function load() {
    let raw
    try {
      raw = readFileSync(path, 'utf8')
    } catch (err) {
      if (err.code !== 'ENOENT')
        logger.warn('persist: unreadable state file ignored', {
          file,
          error: err.message,
        })
      return null
    }
    try {
      const data = JSON.parse(raw)
      if (data && typeof data === 'object') return data
    } catch {
      // falls through to the warning
    }
    logger.warn('persist: corrupt state file ignored', { file })
    return null
  }

  function flush() {
    if (timer) clearTimeout(timer)
    timer = null
    if (!dirty) return
    dirty = false
    const tmp = `${path}.${process.pid}.tmp`
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      writeFileSync(tmp, JSON.stringify(snapshot()), { mode: 0o600 })
      chmodSync(tmp, 0o600)
      renameSync(tmp, path)
    } catch (err) {
      logger.warn('persist: state not saved', { file, error: err.message })
    }
  }

  function changed() {
    dirty = true
    if (timer) return
    timer = setTimeout(flush, delayMs)
    timer.unref?.()
  }

  const store = {
    enabled: true,
    load,
    changed,
    flush,
    close() {
      flush()
      stores.delete(store)
    },
  }
  stores.add(store)
  return store
}

/** Writes every store's pending changes now (on shutdown). */
export function flushAll() {
  for (const s of stores) s.flush()
}
