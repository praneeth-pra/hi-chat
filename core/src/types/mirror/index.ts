/**
 * The remote mirror's wire protocol: every JSON message Hi-chat (the sender),
 * a /m/<link> page (the viewer) and the relay (relay/mirror.mjs) exchange,
 * plus the direct WebRTC data channel between sender and viewer.
 *
 * This file is the one definition. The relay is plain JS and keeps its copy
 * of the version, kinds and close codes in relay/protocol.mjs; a relay test
 * (relay/protocol.test.mjs) reads this file as text and fails if the two
 * drift, so change both together.
 *
 * Versioning: senders and viewers say which version they speak with `v` in
 * the socket URL (`?v=1`). The relay accepts sockets and messages without
 * `v` (older native apps) and closes with MIRROR_CLOSE_VERSION_UNSUPPORTED
 * when `v` is newer than it knows. Bump the version for changes an older
 * relay or peer would get wrong, not for new optional fields.
 */

/** The protocol version this build speaks. Keep relay/protocol.mjs equal. */
export const MIRROR_PROTOCOL_VERSION = 1

/** Close code for a link's viewer when the link has ended. */
export const MIRROR_CLOSE_LINK_ENDED = 4001
/** Close code when a socket or message says a newer `v` than the relay's. */
export const MIRROR_CLOSE_VERSION_UNSUPPORTED = 4002

/** Every message kind (`t`), on any route. Keep relay/protocol.mjs equal. */
export const MIRROR_KINDS = [
  // Updates, sender -> relay -> viewers (and the direct channel)
  'snap',
  'ops',
  'stream',
  'shown',
  'img',
  'phase',
  'scroll',
  'look',
  'typing',
  // Keepalive and timing, any route
  'ping',
  'pong',
  // WebRTC setup, passed on by the relay
  'rtc',
  // Relay -> sender
  'viewers',
  'peer',
  'knock',
  // Sender -> relay: a link's door, and ending a link
  'admit',
  'gate',
  'revoke',
  // Relay -> viewer
  'sender',
  'admitted',
  'code',
  // Viewer -> relay: asking for a code ('code' carries the typed one)
  'unlock',
  // Direct channel, sender -> viewer, on open
  'hello',
] as const

export type MirrorKind = (typeof MIRROR_KINDS)[number]

/** Updates tagged with the sender's session `s` and sequence number `q`. */
export const MIRROR_SEQUENCED_KINDS = [
  'snap',
  'ops',
  'stream',
  'phase',
  'scroll',
  'shown',
  'look',
  'typing',
] as const satisfies readonly MirrorKind[]

export type MirrorSequencedKind = (typeof MIRROR_SEQUENCED_KINDS)[number]

/** A sequenced update's tag: the sender's session and its number there. */
export type MirrorSeqTag = { s?: string; q?: number }

/** Optional on any message: the protocol version its sender speaks. */
export type MirrorVersioned = { v?: number }

// Conversation

/** An Accuracy review as the mirror shows it (as under the answer in Hi-chat). */
export type MirrorReview = {
  verdict: string
  fallback?: string
  verifier?: string
  webStatus?: string
  sources: { title: string; url: string }[]
}

/** A message as the mirror shows it: what Hi-chat's chat shows for it. */
export type MirrorMessage = {
  id: string
  role: 'user' | 'assistant'
  /** For a question, its text without attached files; for an answer, its
   * whole text, thinking included (the mirror folds it as Hi-chat does) */
  text: string
  /** Names of files attached to a question */
  files?: string[]
  /** Keys of images (screenshots) attached to a question, sent as 'img' */
  images?: string[]
  /** An answer stopped before it finished */
  stopped?: boolean
  /** How long an answer's model thought, in seconds ("Thought for 2s") */
  thinking?: number
  review?: MirrorReview
  /** Tools an answer used */
  tools?: { name: string; pending: boolean }[]
}

export type MirrorPhase = 'searching' | 'drafting' | 'verifying'

// Updates (sender -> relay -> viewers, and over the direct channel)

/** The whole conversation. */
export type MirrorSnap = { t: 'snap'; title: string; msgs: MirrorMessage[] }
/** What changed: `set` replaces messages by id, `add` appends. */
export type MirrorOps = {
  t: 'ops'
  title?: string
  set?: MirrorMessage[]
  add?: MirrorMessage[]
}
/** The reply being written: `text` whole, `add` what's new, or ended (null). */
export type MirrorStream =
  | { t: 'stream'; id: null }
  | { t: 'stream'; id: string; text: string }
  | { t: 'stream'; id: string; add: string }
/** How many characters of a reply's answer Hi-chat shows right now. */
export type MirrorShown = { t: 'shown'; id: string; n: number }
/** An image a message shows, sent once, by key. Not sequenced. */
export type MirrorImage = { t: 'img'; key: string; src: string }
/** Accuracy mode's progress, or null. */
export type MirrorPhaseUpdate = { t: 'phase'; phase: MirrorPhase | null }
/**
 * Where the chat is scrolled to: at the bottom, or at a message (`id`) and how
 * far into it the top of the view is (`f`, 0 to 1).
 */
export type MirrorScroll =
  | { t: 'scroll'; bottom: true }
  | {
      t: 'scroll'
      id: string
      f: number
      /** Exactly how far into it, in px (negative: in the gap above it) */
      px?: number
      /** Its height here, in px, so a viewer can scale `px` to its own */
      h?: number
    }
/** How Hi-chat looks, so the mirror can look the same. */
export type MirrorLook = {
  t: 'look'
  /** The chat column's width, in px */
  width: number
  dark: boolean
  /** Hi-chat's CSS variables (colours, font, font size) */
  vars: Record<string, string>
}
/** What is in Hi-chat's message box. */
export type MirrorTyping = { t: 'typing'; text: string }

export type MirrorUpdate = (
  | MirrorSnap
  | MirrorOps
  | MirrorStream
  | MirrorShown
  | MirrorPhaseUpdate
  | MirrorScroll
  | MirrorLook
  | MirrorTyping
) &
  MirrorSeqTag

// Keepalive

/** A ping; `n` (a timestamp) comes back in the pong, for timing. */
export type MirrorPing = { t: 'ping'; n?: number }
export type MirrorPong = { t: 'pong'; n?: number }

// WebRTC setup

/** One side of the setup: an offer or answer, or an ICE candidate. */
export type MirrorRtcPayload =
  | { type: 'offer' | 'answer'; sdp: string }
  | { candidate: RTCIceCandidateInitLike | null }
/** Setup sent to the relay, for the socket `to`. */
export type MirrorRtcOut = { t: 'rtc'; to: string } & MirrorRtcPayload
/** Setup the relay passes on, from the socket `from` (with ICE on offers). */
export type MirrorRtcIn = {
  t: 'rtc'
  from: string
  type?: 'offer' | 'answer'
  sdp?: string
  candidate?: RTCIceCandidateInitLike | null
  ice?: IceServerLike[]
}
/** RTCIceCandidateInit, without needing the DOM types. */
export type RTCIceCandidateInitLike = {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
}
/** RTCIceServer, without needing the DOM types. */
export type IceServerLike = {
  urls: string | string[]
  username?: string
  credential?: string
}

// Relay -> sender

/** How many viewers watch the sender's channels. */
export type MirrorViewers = { t: 'viewers'; n: number }
/** A viewer to connect to directly (`on`), or gone. */
export type MirrorPeer =
  | { t: 'peer'; id: string; on: true; ice: IceServerLike[]; link?: true }
  | { t: 'peer'; id: string; on: false }
/** A link's viewer at the door: asking for a code, typing one, or gone. */
export type MirrorKnock = {
  t: 'knock'
  from: string
  ask?: boolean
  code?: string
  gone?: boolean
}

// Sender -> relay

/** Let the waiting viewer `to` in. */
export type MirrorAdmit = { t: 'admit'; to: string }
/** Tell the waiting viewer `to` its code was wrong (`left` tries left). */
export type MirrorGateReply = {
  t: 'gate'
  to: string
  left: number
  spent?: boolean
}
/** "New link": the app's old link stops working now. */
export type MirrorRevoke = { t: 'revoke'; link: string }

// Relay -> viewer

/** Whether a sender is connected. */
export type MirrorSenderStatus = { t: 'sender'; on: boolean }
/** A link's door is shut: the viewer needs a code. */
export type MirrorGate = { t: 'gate' }
/** In: the ticket lets the viewer back in after a dropped connection. */
export type MirrorAdmitted = { t: 'admitted'; ticket?: string }
/** The code typed was wrong; `locked`: the link takes no more codes. */
export type MirrorCodeResult = {
  t: 'code'
  ok: false
  left: number
  spent?: boolean
  locked?: boolean
}

// Viewer -> relay

/** Ask Hi-chat to show a code. */
export type MirrorUnlock = { t: 'unlock' }
/** The 4 digits typed. */
export type MirrorCode = { t: 'code'; code: string }

// Direct channel (sender -> viewer)

/** On open: whether the viewer may control the sender's computer. */
export type MirrorHello = { t: 'hello'; control: boolean }

/** What a sender sends to the relay. */
export type MirrorFromSender = MirrorVersioned &
  (
    | MirrorUpdate
    | MirrorImage
    | MirrorPing
    | MirrorRtcOut
    | MirrorAdmit
    | MirrorGateReply
    | MirrorRevoke
  )
/** What the relay sends a sender. */
export type MirrorToSender =
  | MirrorViewers
  | MirrorPeer
  | MirrorKnock
  | MirrorRtcIn
  | MirrorPong
/** What a viewer sends to the relay. */
export type MirrorFromViewer = MirrorVersioned &
  (MirrorPing | MirrorRtcOut | MirrorUnlock | MirrorCode)
/** What the relay sends a viewer. */
export type MirrorToViewer =
  | MirrorUpdate
  | MirrorImage
  | MirrorSenderStatus
  | MirrorGate
  | MirrorAdmitted
  | MirrorCodeResult
  | MirrorRtcIn
  | MirrorPong
/** What the direct channel carries from sender to viewer. */
export type MirrorDirectMessage =
  | MirrorUpdate
  | MirrorHello
  | MirrorPing
  | MirrorPong
