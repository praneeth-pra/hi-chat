// Remote mirror: Hi-chat (the sender) sends the open conversation over
// /api/mirror?role=send, and any signed-in browser that opens /mirror (a
// viewer, on /api/mirror?role=view) sees it live, replies included while they
// stream. Text, not video, so it arrives in about a network round trip.
//
// The hub keeps only the latest conversation in memory, so a viewer that
// joins late starts from it. Senders hear how many viewers there are and send
// nothing while there are none.

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

export function createMirrorHub() {
  const senders = new Set()
  const viewers = new Set()
  let snap = null // JSON of the latest conversation
  let stream = null // { id, text } of the reply being written

  const toViewers = (data) => {
    for (const v of viewers) v.send(data)
  }
  const status = () => {
    const count = JSON.stringify({ t: 'viewers', n: viewers.size })
    for (const s of senders) s.send(count)
    toViewers(JSON.stringify({ t: 'sender', on: senders.size > 0 }))
  }

  function fromSender(raw) {
    if (typeof raw !== 'string') return
    let m
    try {
      m = JSON.parse(raw)
    } catch {
      return
    }
    if (m?.t === 'snap') {
      const clean = cleanSnapshot(m)
      if (!clean) return
      snap = JSON.stringify(clean)
      // A finished reply arrives as a message, so the stream ends with it
      if (stream && clean.msgs.some((x) => x.id === stream.id)) stream = null
      toViewers(snap)
    } else if (m?.t === 'stream') {
      if (m.id === null) {
        stream = null
        toViewers(JSON.stringify({ t: 'stream', id: null }))
      } else if (typeof m.id !== 'string') {
        return
      } else if (typeof m.text === 'string') {
        stream = { id: m.id.slice(0, 100), text: m.text.slice(0, MAX_TEXT) }
        toViewers(JSON.stringify({ t: 'stream', ...stream }))
      } else if (
        typeof m.add === 'string' &&
        stream?.id === m.id &&
        stream.text.length + m.add.length <= MAX_TEXT
      ) {
        stream.text += m.add
        toViewers(JSON.stringify({ t: 'stream', id: stream.id, add: m.add }))
      }
    }
  }

  return {
    /** Adds a socket from acceptWebSocket as a sender or a viewer. */
    join(ws, role) {
      if (role === 'send') {
        senders.add(ws)
        ws.onmessage = (data) => fromSender(data)
        ws.onclose = () => {
          senders.delete(ws)
          status()
        }
      } else {
        viewers.add(ws)
        ws.onmessage = () => {} // pings; viewers only listen
        ws.onclose = () => {
          viewers.delete(ws)
          status()
        }
        if (snap) ws.send(snap)
        if (stream) ws.send(JSON.stringify({ t: 'stream', ...stream }))
      }
      status()
    },
    get counts() {
      return { senders: senders.size, viewers: viewers.size }
    },
  }
}
