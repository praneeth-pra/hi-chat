import { randomBytes } from 'node:crypto'

// Remote mirror: Hi-chat (the sender) sends the open conversation over
// /api/mirror?role=send, and any signed-in browser that opens /mirror (a
// viewer, on /api/mirror?role=view) sees it live, replies included while they
// stream. Text, not video, so it arrives in about a network round trip.
//
// What a sender sends (all JSON):
//   snap   the whole conversation (on a new viewer, a new chat, or anything
//          'ops' can't say)
//   ops    only what changed: `set` (messages replaced, by id) and `add`
//          (messages appended), so a long chat costs no more than a short one
//   stream the reply being written: `text` whole, or `add` what's new
//   img    an image a message shows (screenshots), sent once, by `key`
//   phase  Accuracy mode's progress (searching, drafting, verifying) or null
//   scroll where the chat is scrolled to
//   look   how Hi-chat looks: its colours, font and size (CSS variables),
//          dark or light, and the chat column's width, so /mirror matches it
//   typing what is in Hi-chat's message box
//
// The hub keeps the latest of each in memory, so a viewer that joins late
// starts from it. Senders hear how many viewers there are and send nothing
// while there are none.
//
// Direct connections: the hub also passes WebRTC setup ('rtc') between a
// sender and each viewer, so the two can open a data channel straight to each
// other and skip this server. A sender sends every update both ways, tagged
// with its session `s` and a sequence number `q`, which the hub passes on;
// the viewer applies each `q` once, from whichever route brings it first.

// Under wsProxy's 1 MB message cap, which would close the socket
const MAX_TEXT = 900_000
const MAX_MESSAGES = 200
// Images a channel keeps for viewers that join late
const MAX_IMAGE = 900_000
const MAX_IMAGES = 24
const MAX_IMAGE_BYTES = 8_000_000

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
const KEY_RE = /^[\w:.-]{1,120}$/
const PHASES = new Set(['searching', 'drafting', 'verifying'])

const strings = (v, max, each) =>
  Array.isArray(v)
    ? v
        .filter((x) => typeof x === 'string')
        .slice(0, max)
        .map((x) => x.slice(0, each))
    : undefined

const httpUrl = (u) =>
  typeof u === 'string' && /^https?:\/\//.test(u) ? u.slice(0, 2000) : null

/** The Accuracy review shown under an answer, kept to known fields. */
function cleanReview(r) {
  if (!r || typeof r !== 'object') return undefined
  const sources = Array.isArray(r.sources)
    ? r.sources
        .slice(0, 20)
        .map((s) => ({ title: str(s?.title, 300), url: httpUrl(s?.url) }))
        .filter((s) => s.url)
    : []
  return {
    verdict: str(r.verdict, 20),
    fallback: str(r.fallback, 40) || undefined,
    verifier: str(r.verifier, 120) || undefined,
    webStatus: str(r.webStatus, 20) || undefined,
    sources,
  }
}

/** One message, kept to known fields, its text at most `room` long. */
function cleanMessage(raw, room) {
  const msg = {
    id: str(raw?.id, 100),
    role: raw?.role === 'user' ? 'user' : 'assistant',
    text: str(raw?.text, room),
  }
  const files = strings(raw?.files, 20, 200)
  if (files?.length) msg.files = files
  const images = strings(raw?.images, 10, 120)?.filter((k) => KEY_RE.test(k))
  if (images?.length) msg.images = images
  if (raw?.stopped === true) msg.stopped = true
  if (typeof raw?.thinking === 'number' && Number.isFinite(raw.thinking))
    msg.thinking = Math.min(36_000, Math.max(0, raw.thinking))
  const review = cleanReview(raw?.review)
  if (review) msg.review = review
  if (Array.isArray(raw?.tools)) {
    const tools = raw.tools
      .slice(0, 20)
      .map((t) => ({ name: str(t?.name, 80), pending: t?.pending === true }))
    if (tools.length) msg.tools = tools
  }
  return msg
}

/** A conversation, newest kept, within the size cap. */
function cleanMessages(list) {
  let room = MAX_TEXT
  const msgs = []
  for (const raw of list.slice(-MAX_MESSAGES).reverse()) {
    const msg = cleanMessage(raw, room)
    room -= msg.text.length
    msgs.unshift(msg)
    if (room <= 0) break
  }
  return msgs
}

const MAX_TYPING = 20_000
const VAR_RE = /^--[\w-]{1,60}$/

/**
 * How Hi-chat looks, kept to CSS variables with plain values (colours, sizes,
 * font names; nothing that loads anything), dark or not, and the chat
 * column's width in px. Null if it isn't one.
 */
export function cleanLook(m) {
  if (!m || typeof m !== 'object') return null
  const vars = {}
  if (m.vars && typeof m.vars === 'object')
    for (const [k, v] of Object.entries(m.vars).slice(0, 80))
      if (
        VAR_RE.test(k) &&
        typeof v === 'string' &&
        v.length <= 300 &&
        !/url\(|[;{}<>\\]|@import|expression/i.test(v)
      )
        vars[k] = v
  const width =
    typeof m.width === 'number' && Number.isFinite(m.width)
      ? Math.round(Math.min(4000, Math.max(0, m.width)))
      : 0
  return { t: 'look', width, dark: m.dark === true, vars }
}

/** The conversation a sender sent, kept to known fields, or null. */
export function cleanSnapshot(m) {
  if (!Array.isArray(m?.msgs)) return null
  return { t: 'snap', title: str(m.title, 300), msgs: cleanMessages(m.msgs) }
}

/**
 * Applies a sender's 'ops' to a conversation: `set` replaces messages by id,
 * `add` appends. Returns the cleaned ops to pass on, or null if they don't fit
 * (the sender then sends a 'snap').
 */
export function applyOps(snap, m) {
  if (!snap) return null
  const set = Array.isArray(m?.set)
    ? m.set.map((x) => cleanMessage(x, MAX_TEXT))
    : []
  const add = Array.isArray(m?.add)
    ? m.add.map((x) => cleanMessage(x, MAX_TEXT))
    : []
  const msgs = snap.msgs.slice()
  for (const x of set) {
    const i = msgs.findIndex((y) => y.id === x.id)
    if (i === -1) return null
    msgs[i] = x
  }
  msgs.push(...add)
  snap.msgs = cleanMessages(msgs)
  if (typeof m.title === 'string') snap.title = str(m.title, 300)
  return { t: 'ops', title: snap.title, set, add }
}

const endsStream = (msgs, stream) => {
  if (!stream) return false
  const last = msgs[msgs.length - 1]
  return (
    msgs.some((x) => x.id === stream.id) ||
    (last?.role === 'assistant' && last.text.startsWith(stream.text))
  )
}

/** Replies to a viewer's or sender's ping, echoing its `n` for timing. */
function pong(ws, raw) {
  if (typeof raw !== 'string' || !raw.includes('"ping"')) return false
  let n
  try {
    n = JSON.parse(raw)?.n
  } catch {
    return false
  }
  ws.send(
    JSON.stringify(
      typeof n === 'number' && Number.isFinite(n)
        ? { t: 'pong', n }
        : { t: 'pong' }
    )
  )
  return true
}

/** A mirror link's secret: random, URL-safe, long enough not to guess. */
export const LINK_RE = /^[A-Za-z0-9_-]{22,64}$/
/** Close code for a link's viewer when the link has ended. */
export const LINK_ENDED = 4001
// A link keeps working this long after its app closes, so a restart (or the
// remote camera, which uses the link) doesn't lose it; "New link" ends it now
const LINK_GRACE_MS = 12 * 60 * 60 * 1000
/** A link works for 90 minutes from when its app made it, then ends for good. */
export const LINK_TTL_MS = 90 * 60 * 1000
// An ended link's secret is kept this long, so an app still holding it
// (another window, an old tab) can't open it again
const LINK_DEAD_MS = 24 * 60 * 60 * 1000
/**
 * Wrong codes a link takes in all, from every viewer together. Hi-chat
 * counts tries per viewer, and a new connection is a new viewer, so without
 * this a script could reconnect and guess the 4 digits until one came up.
 * After this many the door stays shut; a new link in Hi-chat opens a new one.
 */
export const LINK_WRONG_CODES = 10

const ID_RE = /^[0-9a-f]{16}$/
const SESSION_RE = /^[\w-]{1,40}$/
const MAX_SDP = 64 * 1024

/** The WebRTC setup fields an 'rtc' message may carry, checked. */
function cleanRtc(m) {
  if (typeof m.sdp === 'string' && (m.type === 'offer' || m.type === 'answer'))
    return m.sdp.length <= MAX_SDP ? { type: m.type, sdp: m.sdp } : null
  if (m.candidate === null) return { candidate: null }
  if (m.candidate && typeof m.candidate === 'object') {
    const c = m.candidate
    if (typeof c.candidate !== 'string' || c.candidate.length > 2048)
      return null
    return {
      candidate: {
        candidate: c.candidate,
        sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid.slice(0, 64) : null,
        sdpMLineIndex: Number.isInteger(c.sdpMLineIndex)
          ? c.sdpMLineIndex
          : null,
      },
    }
  }
  return null
}

/** A sender's `s` and `q`, as the start of a JSON object, or ''. */
function seqTag(m) {
  return typeof m?.s === 'string' &&
    SESSION_RE.test(m.s) &&
    Number.isSafeInteger(m.q) &&
    m.q >= 0
    ? `"s":"${m.s}","q":${m.q},`
    : ''
}

export function createMirrorHub({
  now = Date.now,
  ice = { ready: () => null },
  onLinkEnded = () => {},
} = {}) {
  // TURN credentials when ready (fetched in the background), else STUN
  const iceList = () => {
    const list = ice.ready()
    if (!list) ice.load?.()
    return list ?? [{ urls: 'stun:stun.l.google.com:19302' }]
  }
  // Each socket's id, for addressing WebRTC setup
  const ids = new Map() // socket -> id
  const byId = new Map() // id -> { ws, role, names }
  const newId = (ws, role, names) => {
    const id = randomBytes(8).toString('hex')
    ids.set(ws, id)
    byId.set(id, { ws, role, names })
    return id
  }
  const forget = (ws) => {
    byId.delete(ids.get(ws))
    ids.delete(ws)
  }
  // The tag of the update being passed on (see seqTag)
  let tag = ''
  // '' is the signed-in /mirror, where every app sends; a link's secret
  // names its own channel, where only that app sends
  const channels = new Map()
  const links = new Map() // secret -> { live, until, born, tickets }
  // A link's viewer waiting at the door: its id -> how to let it in
  const doors = new Map()
  const dead = new Map() // ended secret -> when to forget it
  const senderChannels = new Map() // sender socket -> its channels

  const channel = (name) => {
    let ch = channels.get(name)
    if (!ch) {
      ch = {
        senders: new Set(),
        viewers: new Set(),
        snap: null, // the conversation, as an object
        stream: null,
        scroll: null,
        phase: null,
        look: null,
        typing: null,
        images: new Map(), // key -> JSON of its 'img' message
        waiting: new Set(), // a link's viewers not yet let in with a code
      }
      channels.set(name, ch)
    }
    return ch
  }
  const tidy = (name) => {
    const ch = channels.get(name)
    if (name && ch && !ch.senders.size && !ch.viewers.size && !ch.waiting.size)
      channels.delete(name)
  }
  const toViewers = (ch, data) => {
    const out = tag && data[0] === '{' ? '{' + tag + data.slice(1) : data
    for (const v of ch.viewers) v.send(out)
  }
  // A sender hears of each viewer (in any of its channels) it may connect to.
  // A link's viewer (no login) is marked as one; it was let in with the code
  // Hi-chat showed, and on the Mac may control the computer
  const peerNote = (id, on, name = '') =>
    JSON.stringify(
      on
        ? { t: 'peer', id, on, ice: iceList(), ...(name ? { link: true } : {}) }
        : { t: 'peer', id, on }
    )
  const status = (names) => {
    for (const name of names) {
      const ch = channels.get(name)
      if (!ch) continue
      const on = JSON.stringify({ t: 'sender', on: ch.senders.size > 0 })
      toViewers(ch, on)
      for (const v of ch.waiting) v.send(on)
      for (const s of ch.senders) sendCount(s)
    }
  }
  // A sender hears how many watch any of its channels
  const sendCount = (s) => {
    let n = 0
    for (const name of senderChannels.get(s) ?? [])
      n += channels.get(name)?.viewers.size ?? 0
    s.send(JSON.stringify({ t: 'viewers', n }))
  }

  const expired = (l) => now() - l.born >= LINK_TTL_MS

  /**
   * Whether `secret` is a link an app has opened, not replaced, and not yet
   * 90 minutes old.
   */
  function isLink(secret) {
    const l = typeof secret === 'string' && links.get(secret)
    if (!l) return false
    if (expired(l)) {
      end(secret)
      return false
    }
    if (l.live > 0 || l.until > now()) return true
    links.delete(secret)
    return false
  }

  // A link ends for good: replaced ("New link", "Revoke") or out of time.
  // Its viewers are closed, and the secret never opens again
  function end(secret) {
    if (!LINK_RE.test(secret ?? '')) return
    links.delete(secret)
    dead.set(secret, now() + LINK_DEAD_MS)
    const ch = channels.get(secret)
    if (ch) {
      for (const v of [...ch.viewers, ...ch.waiting]) v.close(LINK_ENDED)
      // Its app stops sending there (the signed-in /mirror goes on)
      for (const s of ch.senders)
        senderChannels.set(
          s,
          (senderChannels.get(s) ?? []).filter((n) => n !== secret)
        )
      ch.senders.clear()
      tidy(secret)
    }
    onLinkEnded(secret)
  }

  /** Ends the links that are out of time (run every few seconds). */
  function sweep() {
    for (const [secret, l] of links) if (expired(l)) end(secret)
    for (const [secret, until] of dead) if (until <= now()) dead.delete(secret)
  }

  // A finished reply arrives as a message, so the stream ends with it. It is
  // saved under a new id, so a last reply carrying on from the streamed text
  // counts too
  const endStreamIfDone = (ch) => {
    if (ch.snap && endsStream(ch.snap.msgs, ch.stream)) ch.stream = null
  }

  function onSnap(ch, m) {
    const clean = cleanSnapshot(m)
    if (!clean) return
    ch.snap = clean
    endStreamIfDone(ch)
    toViewers(ch, JSON.stringify(clean))
  }

  function onOps(ch, m) {
    const ops = applyOps(ch.snap, m)
    if (!ops) return
    endStreamIfDone(ch)
    toViewers(ch, JSON.stringify(ops))
  }

  function onImage(ch, m) {
    const key = str(m.key, 120)
    const src = typeof m.src === 'string' ? m.src : ''
    if (!KEY_RE.test(key) || src.length > MAX_IMAGE) return
    if (!/^data:image\/(jpeg|png|webp|gif);base64,/.test(src) && !httpUrl(src))
      return
    const data = JSON.stringify({ t: 'img', key, src })
    ch.images.delete(key)
    ch.images.set(key, data)
    // Keep the newest within the caps
    let bytes = 0
    for (const v of ch.images.values()) bytes += v.length
    for (const k of ch.images.keys()) {
      if (ch.images.size <= MAX_IMAGES && bytes <= MAX_IMAGE_BYTES) break
      bytes -= ch.images.get(k).length
      ch.images.delete(k)
    }
    toViewers(ch, data)
  }

  function onPhase(ch, m) {
    ch.phase = PHASES.has(m.phase) ? m.phase : null
    toViewers(ch, JSON.stringify({ t: 'phase', phase: ch.phase }))
  }

  function onScroll(ch, m) {
    // At the bottom, or at a message and how far into it
    const clean =
      m.bottom === true
        ? { t: 'scroll', bottom: true }
        : typeof m.id === 'string' &&
            typeof m.f === 'number' &&
            Number.isFinite(m.f)
          ? {
              t: 'scroll',
              id: m.id.slice(0, 100),
              f: Math.min(1, Math.max(0, m.f)),
              // Exactly how far into it, and its height (px)
              ...(Number.isFinite(m.px) &&
              Number.isFinite(m.h) &&
              m.h > 0 &&
              Math.abs(m.px) <= 1e6 &&
              m.h <= 1e6
                ? { px: Math.round(m.px), h: Math.round(m.h) }
                : {}),
            }
          : null
    if (!clean) return
    ch.scroll = JSON.stringify(clean)
    toViewers(ch, ch.scroll)
  }

  function onStream(ch, m) {
    if (m.id === null) {
      ch.stream = null
      toViewers(ch, JSON.stringify({ t: 'stream', id: null }))
    } else if (typeof m.id !== 'string') {
      return
    } else if (typeof m.text === 'string') {
      ch.stream = { id: m.id.slice(0, 100), text: m.text.slice(0, MAX_TEXT) }
      toViewers(ch, JSON.stringify({ t: 'stream', ...ch.stream }))
    } else if (
      typeof m.add === 'string' &&
      ch.stream?.id === m.id &&
      ch.stream.text.length + m.add.length <= MAX_TEXT
    ) {
      ch.stream.text += m.add
      toViewers(
        ch,
        JSON.stringify({ t: 'stream', id: ch.stream.id, add: m.add })
      )
    }
  }

  // How much of the reply Hi-chat shows right now, each frame it reveals
  // more, so viewers show exactly that. Passed on, not kept: a late viewer
  // has the whole reply already
  function onShown(ch, m) {
    if (typeof m.id !== 'string' || !Number.isSafeInteger(m.n)) return
    const n = Math.min(MAX_TEXT, Math.max(0, m.n))
    toViewers(ch, JSON.stringify({ t: 'shown', id: m.id.slice(0, 100), n }))
  }

  function onLook(ch, m) {
    const clean = cleanLook(m)
    if (!clean) return
    ch.look = JSON.stringify(clean)
    toViewers(ch, ch.look)
  }

  function onTyping(ch, m) {
    const text = str(m.text, MAX_TYPING)
    ch.typing = text ? JSON.stringify({ t: 'typing', text }) : null
    toViewers(ch, JSON.stringify({ t: 'typing', text }))
  }

  const HANDLERS = {
    look: onLook,
    typing: onTyping,
    shown: onShown,
    snap: onSnap,
    ops: onOps,
    img: onImage,
    phase: onPhase,
    scroll: onScroll,
    stream: onStream,
  }

  function fromSender(ws, raw) {
    if (typeof raw !== 'string') return
    if (pong(ws, raw)) return
    let m
    try {
      m = JSON.parse(raw)
    } catch {
      return
    }
    // "New link": the app's old link stops working now
    if (m?.t === 'revoke') return end(m.link)
    // Letting a link's viewer in (the right code), or telling it the code
    // was wrong
    if (m?.t === 'admit' || m?.t === 'gate') return atDoor(ws, m)
    // Setting up a direct connection with one of its viewers
    if (m?.t === 'rtc') return rtcToViewer(ws, m)
    const handle = Object.hasOwn(HANDLERS, m?.t) ? HANDLERS[m.t] : null
    if (!handle) return
    // Images aren't sequenced: they go by key, and only this way
    tag = m.t === 'img' ? '' : seqTag(m)
    try {
      for (const name of senderChannels.get(ws) ?? []) handle(channel(name), m)
    } finally {
      tag = ''
    }
  }

  function rtcToViewer(ws, m) {
    const to = typeof m.to === 'string' && ID_RE.test(m.to) && byId.get(m.to)
    const names = senderChannels.get(ws) ?? []
    if (!to || to.role !== 'view' || !names.includes(to.names[0])) return
    const clean = cleanRtc(m)
    if (!clean) return
    to.ws.send(
      JSON.stringify({
        t: 'rtc',
        from: ids.get(ws),
        ...clean,
        ...(clean.type === 'offer' ? { ice: iceList() } : {}),
      })
    )
  }

  function rtcToSender(ws, name, raw) {
    let m
    try {
      m = JSON.parse(raw)
    } catch {
      return
    }
    if (m?.t !== 'rtc') return
    const to = typeof m.to === 'string' && ID_RE.test(m.to) && byId.get(m.to)
    if (!to || to.role !== 'send' || !to.names.includes(name)) return
    const clean = cleanRtc(m)
    if (clean)
      to.ws.send(JSON.stringify({ t: 'rtc', from: ids.get(ws), ...clean }))
  }

  // When the app says it made `link` (it keeps the time, so a restart of
  // this server doesn't give an old link a fresh 90 minutes); never later
  // than now, nor later than the server first heard of it
  const bornAt = (link, born) => {
    const said = Number(born)
    const t = Number.isFinite(said) && said > 0 ? Math.min(said, now()) : now()
    return Math.min(t, links.get(link)?.born ?? Infinity)
  }

  function joinSender(ws, link, born) {
    const names = ['']
    if (LINK_RE.test(link ?? '') && !dead.has(link)) {
      const at = bornAt(link, born)
      if (now() - at < LINK_TTL_MS) names.push(link)
      else end(link)
    }
    senderChannels.set(ws, names)
    for (const name of names) channel(name).senders.add(ws)
    if (names[1]) {
      const l = links.get(link) ?? {
        live: 0,
        until: 0,
        born: 0,
        tickets: new Set(),
        wrong: 0, // codes typed and not (yet) let in, see LINK_WRONG_CODES
      }
      l.live += 1
      l.born = bornAt(link, born)
      links.set(link, l)
    }
    newId(ws, 'send', names)
    ws.onmessage = (data) => fromSender(ws, data)
    ws.onclose = () => {
      forget(ws)
      senderChannels.delete(ws)
      for (const name of names) channels.get(name)?.senders.delete(ws)
      const l = names[1] && links.get(link)
      if (l) {
        l.live -= 1
        if (l.live <= 0) l.until = now() + LINK_GRACE_MS
      }
      status(names)
      names.forEach(tidy)
    }
    status(names)
    // The viewers already watching, to connect to directly
    for (const name of names)
      for (const v of channels.get(name)?.viewers ?? [])
        ws.send(peerNote(ids.get(v), true, name))
  }

  // The app that answers a link's door: its newest window
  const doorman = (ch) => [...ch.senders].at(-1)

  function atDoor(ws, m) {
    const door = typeof m.to === 'string' && doors.get(m.to)
    if (!door || !(senderChannels.get(ws) ?? []).includes(door.name)) return
    if (m.t === 'admit') return door.admit()
    const left = Number.isInteger(m.left) ? Math.max(0, m.left) : 0
    door.ws.send(
      JSON.stringify({
        t: 'code',
        ok: false,
        left,
        ...(m.spent === true ? { spent: true } : {}),
      })
    )
  }

  /** Whether `ticket` was given to a viewer of `link` let in with a code. */
  function ticketOk(link, ticket) {
    return (
      typeof ticket === 'string' &&
      isLink(link) &&
      links.get(link).tickets.has(ticket)
    )
  }

  // A link's viewer sees nothing until Hi-chat lets it in: it asks for a
  // code (Hi-chat shows it), then types it. Let in, it gets a ticket, which
  // lets it back in after a dropped connection, and lets its camera send
  function joinViewer(ws, link, ticket) {
    const name = link ?? ''
    const ch = channel(name)
    const id = newId(ws, 'view', [name])
    let waiting = !!name && !ticketOk(name, ticket)
    let knocks = 0
    const knock = (raw) => {
      let m
      try {
        m = JSON.parse(raw)
      } catch {
        return
      }
      const to = doorman(ch)
      if (!to || ++knocks > 40) return
      const l = links.get(name)
      if (!l) return
      // Too many wrong codes on this link: no more codes, from anyone
      if (l.wrong >= LINK_WRONG_CODES) {
        if (m?.t === 'unlock' || m?.t === 'code')
          ws.send(
            JSON.stringify({
              t: 'code',
              ok: false,
              left: 0,
              spent: true,
              locked: true,
            })
          )
        return
      }
      if (m?.t === 'unlock')
        to.send(JSON.stringify({ t: 'knock', from: id, ask: true }))
      else if (m?.t === 'code' && /^\d{4}$/.test(m.code ?? '')) {
        // Counted as wrong until Hi-chat lets it in
        l.wrong += 1
        to.send(JSON.stringify({ t: 'knock', from: id, code: m.code }))
      }
    }
    // Viewers mostly listen; a ping gets a pong (echoing its `n`, so the page
    // can time the round trip), which also keeps an idle socket open: nginx
    // closes one that hears nothing for 120 s. They also answer a sender's
    // offer of a direct connection
    ws.onmessage = (raw) => {
      if (typeof raw !== 'string' || raw.length > MAX_SDP + 4096) return
      if (pong(ws, raw)) return
      if (waiting) knock(raw)
      else rtcToSender(ws, name, raw)
    }
    ws.onclose = () => {
      forget(ws)
      if (waiting) {
        doors.delete(id)
        ch.waiting.delete(ws)
        doorman(ch)?.send(JSON.stringify({ t: 'knock', from: id, gone: true }))
        tidy(name)
        return
      }
      ch.viewers.delete(ws)
      for (const s of ch.senders) s.send(peerNote(id, false))
      status([name])
      tidy(name)
    }
    const enter = () => {
      if (name) {
        const l = links.get(name)
        if (!l) return ws.close(LINK_ENDED)
        if (!ticketOk(name, ticket)) {
          ticket = randomBytes(18).toString('base64url')
          l.tickets.add(ticket)
        }
        ws.send(JSON.stringify({ t: 'admitted', ticket }))
      }
      ch.viewers.add(ws)
      for (const img of ch.images.values()) ws.send(img)
      if (ch.snap) ws.send(JSON.stringify(ch.snap))
      if (ch.stream) ws.send(JSON.stringify({ t: 'stream', ...ch.stream }))
      if (ch.phase) ws.send(JSON.stringify({ t: 'phase', phase: ch.phase }))
      if (ch.scroll) ws.send(ch.scroll)
      if (ch.look) ws.send(ch.look)
      if (ch.typing) ws.send(ch.typing)
      status([name])
      for (const s of ch.senders) s.send(peerNote(id, true, name))
    }
    if (!waiting) return enter()
    ch.waiting.add(ws)
    doors.set(id, {
      ws,
      name,
      admit() {
        if (!waiting) return
        // The right code: it wasn't a wrong one after all
        const l = links.get(name)
        if (l) l.wrong = Math.max(0, l.wrong - 1)
        waiting = false
        doors.delete(id)
        ch.waiting.delete(ws)
        enter()
      },
    })
    ws.send(JSON.stringify({ t: 'gate' }))
    ws.send(JSON.stringify({ t: 'sender', on: ch.senders.size > 0 }))
  }

  return {
    /**
     * Adds a socket from acceptWebSocket. A sender (signed in) sends to the
     * signed-in /mirror and, with `link`, to that link's viewers too. A viewer
     * watches the signed-in /mirror, or with `link` (checked with isLink
     * first) only that app, once let in with a code (or its `ticket`).
     * `born` is when the app made its link.
     */
    join(ws, role, { link, born, ticket } = {}) {
      if (role === 'send') joinSender(ws, link, born)
      else joinViewer(ws, link, ticket)
    },
    isLink,
    ticketOk,
    sweep,
    get counts() {
      const ch = channels.get('')
      const senders = ch?.senders.size ?? 0
      let viewers = 0
      for (const c of channels.values()) viewers += c.viewers.size
      return { senders, viewers }
    },
  }
}
