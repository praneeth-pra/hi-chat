// This app's mirror link: /m/<secret> opens, without login, the conversation
// open in this copy of Hi-chat only (the Mac app, the Windows app and each
// browser keep their own). A link works for 90 minutes from when it was
// first shared, then a new one takes its place; "Revoke" ends it sooner. An
// ended link stops working at once (relay/mirror.mjs).

const KEY = 'hichat-mirror-link'
const EVENT = 'hichat-mirror-link'
/** How long a link works (relay/mirror.mjs ends it then too). */
export const LINK_TTL_MS = 90 * 60 * 1000

/** A link: its secret, when it was made, and whether it has been shared. */
type Saved = { s: string; at: number; shared: boolean }

const LINK_RE = /^[A-Za-z0-9_-]{22,64}$/

const read = (): Saved | null => {
  let raw: string | null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return null
  }
  if (!raw) return null
  // Before links ran out, only the secret was kept: its clock starts now
  if (LINK_RE.test(raw)) {
    const v = { s: raw, at: Date.now(), shared: true }
    write(v)
    return v
  }
  try {
    const v = JSON.parse(raw)
    if (
      LINK_RE.test(v?.s ?? '') &&
      Number.isFinite(v.at) &&
      typeof v.shared === 'boolean'
    )
      return v
  } catch {
    // a broken entry: make a new link
  }
  return null
}
const write = (v: Saved) => {
  current = v
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    // private window: the link lasts as long as the page
  }
}

/** A new random secret: 18 bytes, URL-safe (24 characters). */
export function newSecret(random = globalThis.crypto) {
  const bytes = new Uint8Array(18)
  random.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

let current: Saved | null = null

const fresh = (shared = false): Saved => ({
  s: newSecret(),
  at: Date.now(),
  shared,
})
const over = (v: Saved) => Date.now() - v.at >= LINK_TTL_MS

// The saved link (another window may have replaced it), made if missing or
// out of time
function link(): Saved {
  const saved = read() ?? current
  if (saved && !over(saved)) {
    if (saved !== current) current = saved
    return saved
  }
  const next = fresh()
  write(next)
  return next
}

/** This app's link secret, made the first time it's asked for. */
export function mirrorLinkSecret(): string {
  return link().s
}

/** When this app's link was made, in ms since 1970 (the server checks it). */
export function mirrorLinkBorn(): number {
  return link().at
}

/** When this app's link stops working, in ms since 1970. */
export function mirrorLinkExpiresAt(): number {
  return link().at + LINK_TTL_MS
}

const replace = (shared: boolean) => {
  const old = current?.s ?? read()?.s ?? null
  const next = fresh(shared)
  write(next)
  if (old)
    globalThis.dispatchEvent?.(
      new CustomEvent(EVENT, { detail: { old, link: next.s } })
    )
  return next.s
}

/**
 * Ends this app's link now and makes a new one, not yet shared. Returns the
 * new secret.
 */
export function renewMirrorLink(): string {
  return replace(false)
}

/**
 * The link to hand out: the current one if it's already been shared, else a
 * new one, so its 90 minutes start now rather than when it was made.
 */
export function shareMirrorLink(): string {
  const v = link()
  if (v.shared) return v.s
  return replace(true)
}

/** "Ends in 87 min", or "Ends in under a minute". */
export function endsIn(ms: number) {
  const min = Math.floor(ms / 60_000)
  return min < 1 ? 'Ends in under a minute' : `Ends in ${min} min`
}

/** Calls `fn` with the old secret whenever this app's link is replaced. */
export function onMirrorLinkRenewed(fn: (old: string) => void) {
  const listener = (e: Event) =>
    fn((e as CustomEvent<{ old: string }>).detail.old)
  globalThis.addEventListener?.(EVENT, listener)
  return () => globalThis.removeEventListener?.(EVENT, listener)
}

export const mirrorLinkUrl = (
  location: Pick<Location, 'origin'>,
  secret = mirrorLinkSecret()
) => `${location.origin}/m/${secret}`

/** The secret in a /m/<secret> path, or null. */
export function linkFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/m\/([A-Za-z0-9_-]{22,64})\/?$/)
  return m ? m[1] : null
}

/** Copies text, falling back for the apps' web views. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const field = document.createElement('textarea')
    field.value = text
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.append(field)
    field.select()
    const ok = document.execCommand('copy')
    field.remove()
    return ok
  }
}
