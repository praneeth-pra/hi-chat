// The remote mirror's protocol, relay side. The one definition, with types
// for every message, is core/src/types/mirror/index.ts (@janhq/core); the
// relay is plain JS, so it keeps the version, the message kinds and the close
// codes here. protocol.test.mjs reads core's file and fails if they drift:
// change both together.
//
// Senders and viewers say which version they speak with `v` (in the socket
// URL, `?v=1`, or on a message). Without `v` (older native apps) they are
// taken as version 1; with a newer `v` than this one the relay closes the
// socket with MIRROR_CLOSE_VERSION_UNSUPPORTED rather than misread it.

export const MIRROR_PROTOCOL_VERSION = 1

/** Close code for a link's viewer when the link has ended. */
export const MIRROR_CLOSE_LINK_ENDED = 4001
/** Close code when a socket or message says a newer `v` than this relay's. */
export const MIRROR_CLOSE_VERSION_UNSUPPORTED = 4002

/** Every message kind (`t`), on any route, in core's order. */
export const MIRROR_KINDS = Object.freeze([
  'snap',
  'ops',
  'stream',
  'shown',
  'img',
  'phase',
  'scroll',
  'look',
  'typing',
  'ping',
  'pong',
  'rtc',
  'viewers',
  'peer',
  'knock',
  'admit',
  'gate',
  'revoke',
  'sender',
  'admitted',
  'code',
  'unlock',
  'hello',
])

/** Updates tagged with the sender's session `s` and sequence number `q`. */
export const MIRROR_SEQUENCED_KINDS = Object.freeze([
  'snap',
  'ops',
  'stream',
  'phase',
  'scroll',
  'shown',
  'look',
  'typing',
])

/**
 * Whether `v` (from a URL or a message) is a version this relay speaks:
 * missing (older apps), or a number no newer than MIRROR_PROTOCOL_VERSION.
 * Anything that isn't a number counts as missing.
 */
export function versionOk(v) {
  if (v === undefined || v === null || v === '') return true
  const n = typeof v === 'number' ? v : Number(v)
  return !Number.isFinite(n) || n <= MIRROR_PROTOCOL_VERSION
}
