// Remote mirror, sending side: while another signed-in browser has /mirror
// open, Hi-chat sends it the open conversation over /api/mirror (see
// relay/mirror.mjs), and a reply as it streams. With no viewer it sends
// nothing but a ping now and then.

import type { ThreadMessage } from '@janhq/core'
import { useAppState } from '@/hooks/useAppState'
import { useMessages } from '@/hooks/useMessages'
import { useThreads } from '@/hooks/useThreads'

export const MIRROR_PATH = '/mirror'
// The remote laptop's page follows the conversation and sends the camera, so
// it never sends a conversation of its own over the real one
const NOT_SENDING = [MIRROR_PATH]
const PUSH_MS = 40
const PING_MS = 30_000
const MAX_MESSAGES = 200

type MirrorMessage = { id: string; role: 'user' | 'assistant'; text: string }

export const messageText = (m: ThreadMessage | undefined) =>
  m?.content?.find((c) => c.type === 'text')?.text?.value ?? ''

/** The conversation as the viewer shows it: user and assistant text only. */
export function mirrorMessages(messages: ThreadMessage[]): MirrorMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      id: m.id,
      role: m.role === 'user' ? 'user' : 'assistant',
      text: messageText(m),
    }))
}

/**
 * Where the chat is scrolled to: at the bottom, or at a message (`id`) and how
 * far into it the top of the view is (`f`, 0 to 1). By message rather than in
 * pixels, as the viewer's text wraps at its own width.
 */
export type MirrorScroll =
  { t: 'scroll'; bottom: true } | { t: 'scroll'; id: string; f: number }

const AT_BOTTOM_PX = 40
const MESSAGE = '[data-test-id^="message-"]'

/** Reads where the chat's scroll area (`[data-thread-scroller]`) is. */
export function readScroll(el: HTMLElement): MirrorScroll {
  if (el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX)
    return { t: 'scroll', bottom: true }
  const top = el.getBoundingClientRect().top
  for (const m of el.querySelectorAll<HTMLElement>(MESSAGE)) {
    const r = m.getBoundingClientRect()
    if (r.bottom <= top) continue
    const id = (m.dataset.testId ?? '').replace(/^message-[a-z]+-/, '')
    const f =
      r.height > 0 ? Math.min(1, Math.max(0, (top - r.top) / r.height)) : 0
    return { t: 'scroll', id, f: Math.round(f * 1000) / 1000 }
  }
  // Below the last saved message: in the reply being written
  return { t: 'scroll', bottom: true }
}

/** What to send for the streaming reply, given what was sent last. */
export function streamUpdate(
  last: { id: string | null; text: string },
  id: string | null,
  text: string
): Record<string, unknown> | null {
  if (id === null) return last.id === null ? null : { t: 'stream', id: null }
  if (id === last.id && text.startsWith(last.text)) {
    const add = text.slice(last.text.length)
    return add ? { t: 'stream', id, add } : null
  }
  return { t: 'stream', id, text }
}

export function mirrorSocketUrl(
  location: Pick<Location, 'protocol' | 'host'>,
  role: 'send' | 'view'
) {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}/api/mirror?role=${role}`
}

/** Starts sending; returns a function that stops it. */
export function startRemoteMirror({
  WebSocketImpl = globalThis.WebSocket,
  location = globalThis.location,
}: {
  WebSocketImpl?: typeof WebSocket
  location?: Location
} = {}): () => void {
  if (
    !WebSocketImpl ||
    !location ||
    !/^https?:$/.test(location.protocol) ||
    NOT_SENDING.includes(location.pathname)
  )
    return () => {}

  let ws: WebSocket | null = null
  let stopped = false
  let viewers = 0
  let retryMs = 1000
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let pushTimer: ReturnType<typeof setTimeout> | undefined
  // What the viewers already have
  let sentSnap = ''
  let snapKey: unknown[] = []
  let sentStream: { id: string | null; text: string } = { id: null, text: '' }
  let sentScroll = ''

  const send = (data: unknown) => {
    if (ws?.readyState === WebSocketImpl.OPEN) ws.send(JSON.stringify(data))
  }

  function push() {
    pushTimer = undefined
    if (!viewers || ws?.readyState !== WebSocketImpl.OPEN) return
    if (NOT_SENDING.includes(location.pathname)) return
    // With Hi-chat open in several windows, the one in front speaks; one in
    // the background only finishes a reply it is writing
    if (
      globalThis.document?.hidden &&
      !useAppState.getState().streamingContent &&
      sentStream.id === null
    )
      return
    const threadId = useThreads.getState().currentThreadId
    const title = threadId
      ? (useThreads.getState().threads[threadId]?.title ?? '')
      : ''
    const messages = threadId
      ? useMessages.getState().messages[threadId]
      : undefined
    // Rebuild only when the conversation changed, not on every streamed word
    const key = [threadId, title, messages]
    if (key.some((v, i) => v !== snapKey[i])) {
      snapKey = key
      const snap = JSON.stringify({
        t: 'snap',
        title,
        msgs: mirrorMessages(messages ?? []),
      })
      if (snap !== sentSnap) {
        sentSnap = snap
        ws.send(snap)
      }
    }
    const streaming = useAppState.getState().streamingContent
    const live =
      streaming && threadId && streaming.thread_id === threadId
        ? streaming
        : undefined
    const text = messageText(live)
    // The chat gives a streaming reply a new id on every update (and the
    // saved reply another), so a reply is followed by its text: text that
    // carries on from what the viewers have is the same reply, sent as an add
    const id = !live
      ? null
      : sentStream.id !== null && text.startsWith(sentStream.text)
        ? sentStream.id
        : live.id
    const update = streamUpdate(sentStream, id, text)
    if (update) {
      send(update)
      sentStream = { id, text: id === null ? '' : text }
    }
    // Where the chat is scrolled to, so the viewer scrolls with it
    const scroller = globalThis.document?.querySelector<HTMLElement>(
      '[data-thread-scroller]'
    )
    if (scroller && !globalThis.document?.hidden) {
      const scroll = JSON.stringify(readScroll(scroller))
      if (scroll !== sentScroll) {
        sentScroll = scroll
        ws.send(scroll)
      }
    }
  }

  const schedule = () => {
    if (viewers && !pushTimer) pushTimer = setTimeout(push, PUSH_MS)
  }

  function connect() {
    if (stopped) return
    const socket = new WebSocketImpl(mirrorSocketUrl(location, 'send'))
    ws = socket
    socket.onopen = () => {
      retryMs = 1000
    }
    socket.onmessage = (e) => {
      let m: { t?: string; n?: number }
      try {
        m = JSON.parse(String(e.data))
      } catch {
        return
      }
      if (m.t !== 'viewers' || typeof m.n !== 'number') return
      const had = viewers
      viewers = m.n
      // A new viewer starts from the whole conversation
      if (viewers > had) {
        sentSnap = ''
        snapKey = []
        sentStream = { id: null, text: '' }
        sentScroll = ''
        schedule()
      }
    }
    socket.onclose = () => {
      if (ws !== socket) return
      ws = null
      viewers = 0
      if (stopped) return
      retryTimer = setTimeout(connect, retryMs)
      retryMs = Math.min(retryMs * 2, 30_000)
    }
  }

  // Coming to the front: send this window's conversation in full
  const onVisible = () => {
    if (globalThis.document?.hidden) return
    sentSnap = ''
    snapKey = []
    sentScroll = ''
    schedule()
  }
  globalThis.document?.addEventListener('visibilitychange', onVisible)
  // Scrolling the chat (scroll events don't bubble, so listen while capturing)
  const onScroll = (e: Event) => {
    const target = e.target as HTMLElement | null
    if (target?.matches?.('[data-thread-scroller]')) schedule()
  }
  globalThis.document?.addEventListener('scroll', onScroll, true)
  const unsubscribe = [
    useMessages.subscribe(schedule),
    useThreads.subscribe(schedule),
    useAppState.subscribe(schedule),
    () =>
      globalThis.document?.removeEventListener('visibilitychange', onVisible),
    () => globalThis.document?.removeEventListener('scroll', onScroll, true),
  ]
  const ping = setInterval(() => send({ t: 'ping' }), PING_MS)
  connect()

  return () => {
    stopped = true
    unsubscribe.forEach((u) => u())
    clearInterval(ping)
    clearTimeout(retryTimer)
    clearTimeout(pushTimer)
    ws?.close()
    ws = null
  }
}

// Viewing side (routes/mirror.tsx)

type Stream = { id: string; text: string } | null
export type MirrorState = {
  title: string
  msgs: MirrorMessage[]
  stream: Stream
  senderOn: boolean
  /** Where Hi-chat is scrolled to; a new object for each move */
  scroll: { bottom: true } | { id: string; f: number } | null
}

export const emptyMirror: MirrorState = {
  title: '',
  msgs: [],
  stream: null,
  senderOn: false,
  scroll: null,
}

/**
 * Whether these messages include the finished reply being streamed: the same
 * id, or (as the saved reply gets a new id) a last reply that carries on from
 * the streamed text. Keeps the viewer from showing the answer twice.
 */
export function endsStream(
  msgs: { id: string; role: string; text: string }[],
  stream: { id: string; text: string }
) {
  if (msgs.some((x) => x.id === stream.id)) return true
  const last = msgs[msgs.length - 1]
  return last?.role === 'assistant' && last.text.startsWith(stream.text)
}

/** Applies one message from the relay to what the viewer shows. */
export function applyMirrorMessage(
  state: MirrorState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  m: any
): MirrorState {
  if (m?.t === 'snap' && Array.isArray(m.msgs)) {
    const msgs = m.msgs as MirrorMessage[]
    // A finished reply arrives as a message, ending its stream
    const stream =
      state.stream && endsStream(msgs, state.stream) ? null : state.stream
    return { ...state, title: String(m.title ?? ''), msgs, stream }
  }
  if (m?.t === 'stream') {
    if (m.id === null) return { ...state, stream: null }
    if (typeof m.text === 'string')
      return { ...state, stream: { id: m.id, text: m.text } }
    const stream = state.stream
    if (typeof m.add === 'string' && stream && stream.id === m.id)
      return { ...state, stream: { id: m.id, text: stream.text + m.add } }
    return state
  }
  if (m?.t === 'sender') return { ...state, senderOn: m.on === true }
  if (m?.t === 'scroll') {
    if (m.bottom === true) return { ...state, scroll: { bottom: true } }
    if (typeof m.id === 'string' && typeof m.f === 'number')
      return {
        ...state,
        scroll: { id: m.id, f: Math.min(1, Math.max(0, m.f)) },
      }
  }
  return state
}
