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
//
// The hub keeps the latest of each in memory, so a viewer that joins late
// starts from it. Senders hear how many viewers there are and send nothing
// while there are none.

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
// A link keeps working this long after its app closes, so a restart (or the
// remote camera, which uses the link) doesn't lose it; "New link" ends it now
const LINK_GRACE_MS = 12 * 60 * 60 * 1000

export function createMirrorHub({ now = Date.now } = {}) {
  // '' is the signed-in /mirror, where every app sends; a link's secret
  // names its own channel, where only that app sends
  const channels = new Map()
  const links = new Map() // secret -> { live, until }
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
        images: new Map(), // key -> JSON of its 'img' message
      }
      channels.set(name, ch)
    }
    return ch
  }
  const tidy = (name) => {
    const ch = channels.get(name)
    if (name && ch && !ch.senders.size && !ch.viewers.size)
      channels.delete(name)
  }
  const toViewers = (ch, data) => {
    for (const v of ch.viewers) v.send(data)
  }
  const status = (names) => {
    for (const name of names) {
      const ch = channels.get(name)
      if (!ch) continue
      toViewers(ch, JSON.stringify({ t: 'sender', on: ch.senders.size > 0 }))
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

  /** Whether `secret` is a link an app has opened (and not replaced). */
  function isLink(secret) {
    const l = typeof secret === 'string' && links.get(secret)
    if (!l) return false
    if (l.live > 0 || l.until > now()) return true
    links.delete(secret)
    return false
  }

  function revoke(secret) {
    if (!LINK_RE.test(secret ?? '')) return
    links.delete(secret)
    const ch = channels.get(secret)
    if (!ch) return
    for (const v of [...ch.viewers]) v.close(4001)
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

  const HANDLERS = {
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
    if (m?.t === 'revoke') return revoke(m.link)
    const handle = Object.hasOwn(HANDLERS, m?.t) ? HANDLERS[m.t] : null
    if (!handle) return
    for (const name of senderChannels.get(ws) ?? []) handle(channel(name), m)
  }

  function joinSender(ws, link) {
    const names = [''].concat(LINK_RE.test(link ?? '') ? [link] : [])
    senderChannels.set(ws, names)
    for (const name of names) channel(name).senders.add(ws)
    if (names[1]) {
      const l = links.get(link) ?? { live: 0, until: 0 }
      l.live += 1
      links.set(link, l)
    }
    ws.onmessage = (data) => fromSender(ws, data)
    ws.onclose = () => {
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
  }

  function joinViewer(ws, link) {
    const name = link ?? ''
    const ch = channel(name)
    ch.viewers.add(ws)
    // Viewers only listen; a ping gets a pong (echoing its `n`, so the page
    // can time the round trip), which also keeps an idle socket open: nginx
    // closes one that hears nothing for 120 s
    ws.onmessage = (raw) => pong(ws, raw)
    ws.onclose = () => {
      ch.viewers.delete(ws)
      status([name])
      tidy(name)
    }
    for (const img of ch.images.values()) ws.send(img)
    if (ch.snap) ws.send(JSON.stringify(ch.snap))
    if (ch.stream) ws.send(JSON.stringify({ t: 'stream', ...ch.stream }))
    if (ch.phase) ws.send(JSON.stringify({ t: 'phase', phase: ch.phase }))
    if (ch.scroll) ws.send(ch.scroll)
    status([name])
  }

  return {
    /**
     * Adds a socket from acceptWebSocket. A sender (signed in) sends to the
     * signed-in /mirror and, with `link`, to that link's viewers too. A viewer
     * watches the signed-in /mirror, or with `link` (checked with isLink
     * first) only that app.
     */
    join(ws, role, { link } = {}) {
      if (role === 'send') joinSender(ws, link)
      else joinViewer(ws, link)
    },
    isLink,
    get counts() {
      const ch = channels.get('')
      const senders = ch?.senders.size ?? 0
      let viewers = 0
      for (const c of channels.values()) viewers += c.viewers.size
      return { senders, viewers }
    },
  }
}
