// Remote mirror: Hi-chat (the sender) sends the open conversation over
// /api/mirror?role=send, and any signed-in browser that opens /mirror (a
// viewer, on /api/mirror?role=view) sees it live, replies included while they
// stream. Text, not video, so it arrives in about a network round trip.
//
// The hub keeps only the latest conversation (and where it's scrolled to) in
// memory, so a viewer that joins late starts from it. Senders hear how many
// viewers there are and send nothing while there are none.

// Under wsProxy's 1 MB message cap, which would close the socket
const MAX_TEXT = 900_000
const MAX_MESSAGES = 200

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')

/** The conversation a sender sent, kept to known fields, or null. */
export function cleanSnapshot(m) {
  if (!Array.isArray(m?.msgs)) return null
  let room = MAX_TEXT
  const msgs = []
  for (const raw of m.msgs.slice(-MAX_MESSAGES).reverse()) {
    const text = str(raw?.text, room)
    room -= text.length
    msgs.unshift({
      id: str(raw?.id, 100),
      role: raw?.role === 'user' ? 'user' : 'assistant',
      text,
    })
    if (room <= 0) break
  }
  return { t: 'snap', title: str(m.title, 300), msgs }
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
        snap: null,
        stream: null,
        scroll: null,
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

  function onSnap(ch, m) {
    const clean = cleanSnapshot(m)
    if (!clean) return
    ch.snap = JSON.stringify(clean)
    // A finished reply arrives as a message, so the stream ends with it. It
    // is saved under a new id, so a last reply carrying on from the
    // streamed text counts too
    const last = clean.msgs[clean.msgs.length - 1]
    const stream = ch.stream
    if (
      stream &&
      (clean.msgs.some((x) => x.id === stream.id) ||
        (last?.role === 'assistant' && last.text.startsWith(stream.text)))
    )
      ch.stream = null
    toViewers(ch, ch.snap)
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

  function fromSender(ws, raw) {
    if (typeof raw !== 'string') return
    let m
    try {
      m = JSON.parse(raw)
    } catch {
      return
    }
    // "New link": the app's old link stops working now
    if (m?.t === 'revoke') return revoke(m.link)
    const handle =
      m?.t === 'snap'
        ? onSnap
        : m?.t === 'scroll'
          ? onScroll
          : m?.t === 'stream'
            ? onStream
            : null
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
    ws.onmessage = () => {} // pings; viewers only listen
    ws.onclose = () => {
      ch.viewers.delete(ws)
      status([name])
      tidy(name)
    }
    if (ch.snap) ws.send(ch.snap)
    if (ch.stream) ws.send(JSON.stringify({ t: 'stream', ...ch.stream }))
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
      let senders = ch?.senders.size ?? 0
      let viewers = 0
      for (const c of channels.values()) viewers += c.viewers.size
      return { senders, viewers }
    },
  }
}
