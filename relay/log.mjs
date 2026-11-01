// Structured logs: one JSON object per line on stdout,
// {"ts":"…","level":"info","msg":"…", ...fields}, so Railway's log search can
// filter on fields (rid, engine, ms). Never pass secrets, login codes,
// cookies, tokens or transcripts as fields: the keys below are blanked as a
// backstop, not a licence.

const REDACT =
  /^(?:authorization|cookie|set-cookie|token|secret|password|code|key|api_?key|ticket|text|transcript)$/i

// A field can't overwrite the line's own
const RESERVED = new Set(['ts', 'level', 'msg'])

function field(key, value) {
  if (REDACT.test(key)) return '[redacted]'
  if (value instanceof Error) return value.message
  return value
}

/**
 * A logger with debug/info/warn/error(msg, fields). `child(fields)` returns
 * one that adds those fields (e.g. a request's `rid`) to every line.
 */
export function createLogger({
  write = (line) => process.stdout.write(line),
  now = () => new Date(),
  fields: base = {},
} = {}) {
  const emit = (level) => (msg, fields) => {
    const entry = { ts: now().toISOString(), level, msg: String(msg) }
    for (const src of [base, fields])
      for (const [k, v] of Object.entries(src ?? {}))
        if (v !== undefined && !RESERVED.has(k)) entry[k] = field(k, v)
    let line
    try {
      line = JSON.stringify(entry)
    } catch {
      line = JSON.stringify({ ts: entry.ts, level, msg: entry.msg })
    }
    write(line + '\n')
  }
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child: (fields) =>
      createLogger({ write, now, fields: { ...base, ...fields } }),
  }
}

export const log = createLogger()
