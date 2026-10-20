// This app's mirror link: /m#<secret> opens, without login, the conversation
// open in this copy of Hi-chat only (the Mac app, the Windows app and each
// browser keep their own). The secret stays until "New link" replaces it,
// which also ends the old link at once (relay/mirror.mjs). The secret sits in
// the URL's fragment, which browsers never send: it stays out of every
// request line, log and referrer.

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

// Whether a page opened from this app's link may also send its camera into
// Meet. Off unless turned on: a link that can send the camera could put
// someone else's camera into your call
const CAMERA_KEY = 'hichat-mirror-link-camera'
const CAMERA_EVENT = 'hichat-mirror-link-camera'

export function mirrorLinkCamera(): boolean {
  try {
    return localStorage.getItem(CAMERA_KEY) === '1'
  } catch {
    return false
  }
}

export function setMirrorLinkCamera(on: boolean) {
  try {
    if (on) localStorage.setItem(CAMERA_KEY, '1')
    else localStorage.removeItem(CAMERA_KEY)
  } catch {
    // private window
  }
  globalThis.dispatchEvent?.(new CustomEvent(CAMERA_EVENT))
}

/** Calls `fn` whenever the camera-on-link choice changes. */
export function onMirrorLinkCameraChanged(fn: () => void) {
  globalThis.addEventListener?.(CAMERA_EVENT, fn)
  return () => globalThis.removeEventListener?.(CAMERA_EVENT, fn)
}

export const LINK_PATH = '/m'

export const mirrorLinkUrl = (
  location: Pick<Location, 'origin'>,
  secret = mirrorLinkSecret()
) => `${location.origin}${LINK_PATH}#${secret}`

/** The secret in a /m#<secret> address, or null. */
export function linkFromLocation(
  location: Pick<Location, 'pathname' | 'hash'>
): string | null {
  if (!isLinkPath(location.pathname)) return null
  const secret = location.hash.replace(/^#/, '')
  return LINK_RE.test(secret) ? secret : null
}

/** Whether a path is the mirror link page (whatever its fragment). */
export const isLinkPath = (pathname: string) =>
  pathname === LINK_PATH || pathname === `${LINK_PATH}/`

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
