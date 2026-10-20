// This app's mirror link: /m/<secret> opens, without login, the conversation
// open in this copy of Hi-chat only (the Mac app, the Windows app and each
// browser keep their own). The secret stays until "New link" replaces it,
// which also ends the old link at once (relay/mirror.mjs).

const KEY = 'hichat-mirror-link'
const EVENT = 'hichat-mirror-link'

const read = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
const write = (v: string) => {
  try {
    localStorage.setItem(KEY, v)
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

const LINK_RE = /^[A-Za-z0-9_-]{22,64}$/
let current: string | null = null

/** This app's link secret, made the first time it's asked for. */
export function mirrorLinkSecret(): string {
  if (current) return current
  const saved = read()
  current = saved && LINK_RE.test(saved) ? saved : newSecret()
  if (current !== saved) write(current)
  return current
}

/** Replaces this app's link; the old one stops working. Returns the new. */
export function renewMirrorLink(): string {
  const old = mirrorLinkSecret()
  current = newSecret()
  write(current)
  globalThis.dispatchEvent?.(
    new CustomEvent(EVENT, { detail: { old, link: current } })
  )
  return current
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
