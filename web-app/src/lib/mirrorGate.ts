// The door of a mirror link (relay/mirror.mjs): a viewer on /m/<link> sees
// nothing until it types a 4-digit code that Hi-chat shows here. The server
// passes on its knocks ('knock': asking for a code, typing one, or gone) and
// lets it in when Hi-chat says so ('admit'); a wrong code is told back
// ('gate'). Once in, on the Mac it may also control the computer.

/** Wrong codes a viewer may try before it needs to reload the page. */
export const CODE_TRIES = 5
/** How long a code stays good, in ms; then the viewer can ask for another. */
export const CODE_TTL_MS = 5 * 60_000

/** A random 4-digit code, as a string ("0042"). */
export function newCode(): string {
  const n = new Uint32Array(1)
  globalThis.crypto.getRandomValues(n)
  return String(n[0] % 10_000).padStart(4, '0')
}

export type Knock = {
  t: 'knock'
  from: string
  ask?: boolean
  code?: string
  gone?: boolean
}

/**
 * Hi-chat's side of the door: `reply` goes to the server, `onCode` shows the
 * code (null hides it). One code on show at a time, for the latest viewer
 * to ask.
 */
export function createGate({
  reply,
  onCode,
  makeCode = newCode,
  now = Date.now,
}: {
  reply: (
    m: { t: 'admit' | 'gate'; to: string } & Record<string, unknown>
  ) => void
  onCode: (code: string | null) => void
  makeCode?: () => string
  now?: () => number
}) {
  // Each waiting viewer's code, and its wrong tries (over all its codes)
  const codes = new Map<string, { code: string; at: number }>()
  const tries = new Map<string, number>()
  let shownFor: string | null = null
  const hide = (id: string) => {
    codes.delete(id)
    if (shownFor !== id) return
    shownFor = null
    onCode(null)
  }
  const good = (id: string) => {
    const c = codes.get(id)
    return c && now() - c.at <= CODE_TTL_MS ? c : null
  }
  const spent = (id: string) => (tries.get(id) ?? 0) >= CODE_TRIES

  return {
    knock(m: Knock) {
      const id = m.from
      if (typeof id !== 'string') return
      if (m.gone) {
        hide(id)
        tries.delete(id)
        return
      }
      if (m.ask) {
        if (spent(id)) return reply({ t: 'gate', to: id, left: 0, spent: true })
        // Asked again while it's good: the same code; else a new one
        const c = good(id) ?? { code: makeCode(), at: now() }
        codes.set(id, c)
        shownFor = id
        onCode(c.code)
        return
      }
      if (typeof m.code !== 'string') return
      const c = good(id)
      if (spent(id) || !c) {
        hide(id)
        return reply({
          t: 'gate',
          to: id,
          left: 0,
          ...(spent(id) ? { spent: true } : {}),
        })
      }
      if (m.code === c.code) {
        hide(id)
        tries.delete(id)
        return reply({ t: 'admit', to: id })
      }
      const n = (tries.get(id) ?? 0) + 1
      tries.set(id, n)
      const left = CODE_TRIES - n
      if (left <= 0) hide(id)
      reply({ t: 'gate', to: id, left, ...(left <= 0 ? { spent: true } : {}) })
    },
    /** Forgets every viewer (the connection to the server dropped). */
    clear() {
      if (shownFor) onCode(null)
      shownFor = null
      codes.clear()
      tries.clear()
    },
  }
}
