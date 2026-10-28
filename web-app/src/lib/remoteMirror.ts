// Remote mirror, sending side: while another signed-in browser has /mirror
// open, Hi-chat sends it the open conversation over /api/mirror (see
// relay/mirror.mjs), and a reply as it streams. With no viewer it sends
// nothing but a ping now and then.
//
// Latency first: a reply's text goes out the moment it arrives from the
// model (mirrorStreamTap), changes to the conversation as soon as they
// happen (a microtask, not a timer, which a background window slows to once
// a second), and only what changed.

import { MessageStatus, type ThreadMessage } from '@janhq/core'
import type { AccuracyReview } from '@/lib/accuracyReview'
import { extractFilesFromPrompt } from '@/lib/fileMetadata'
import { useAppState } from '@/hooks/useAppState'
import { useMessages } from '@/hooks/useMessages'
import { usePrompt } from '@/hooks/usePrompt'
import { useThreads } from '@/hooks/useThreads'
import { toast } from 'sonner'
import { CODE_TTL_MS, createDirectSender, SEQUENCED } from '@/lib/mirrorDirect'
import {
  linkFromPath,
  mirrorLinkBorn,
  mirrorLinkSecret,
  onMirrorLinkRenewed,
} from '@/lib/mirrorLink'

// The remote laptop's page (/m/<link>) follows the conversation and sends the
// camera, so it never sends a conversation of its own over the real one
const notSending = (pathname: string) => linkFromPath(pathname) !== null
const PING_MS = 30_000
// How often to check whether this app's link ran out
const LINK_CHECK_MS = 15_000
const MAX_MESSAGES = 200
// Screenshots go to the mirror at most this big (a ~3000px Mac screenshot
// would be several MB): sharp enough to read, quick to send
const IMAGE_MAX_PX = 1600
const IMAGE_MAX_CHARS = 850_000

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

export const messageText = (m: ThreadMessage | undefined) =>
  m?.content?.find((c) => c.type === 'text')?.text?.value ?? ''

const imageParts = (m: ThreadMessage) =>
  (m.content ?? []).filter((c) => c.type === 'image_url' && c.image_url?.url)

/** The conversation as the mirror shows it. */
export function mirrorMessages(messages: ThreadMessage[]): MirrorMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-MAX_MESSAGES)
    .map((m) => {
      if (m.role === 'user') {
        const { cleanPrompt, files } = extractFilesFromPrompt(messageText(m))
        const msg: MirrorMessage = { id: m.id, role: 'user', text: cleanPrompt }
        if (files.length) msg.files = files.map((f) => f.name)
        const images = imageParts(m).map((_, i) => `${m.id}.${i}`)
        if (images.length) msg.images = images
        return msg
      }
      const msg: MirrorMessage = {
        id: m.id,
        role: 'assistant',
        text: messageText(m),
      }
      if (m.status === MessageStatus.Stopped) msg.stopped = true
      const thinking = (m.metadata?.timings as { thinking_s?: unknown })
        ?.thinking_s
      if (typeof thinking === 'number' && Number.isFinite(thinking))
        msg.thinking = thinking
      const review = m.metadata?.accuracyReview as AccuracyReview | undefined
      if (review)
        msg.review = {
          verdict: review.verdict,
          fallback: review.fallback,
          verifier: review.verifier,
          webStatus: review.webStatus,
          sources: (review.sources ?? []).map((s) => ({
            title: s.title,
            url: s.url,
          })),
        }
      const calls = m.metadata?.tool_calls
      if (Array.isArray(calls) && calls.length)
        msg.tools = (calls as ToolCall[]).map((c) => ({
          name: c.tool?.function?.name ?? '',
          pending: (c as { state?: string }).state === 'pending',
        }))
      return msg
    })
}

/** The images questions show (screenshots), by the keys mirrorMessages uses. */
export function messageImages(messages: ThreadMessage[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of messages)
    if (m.role === 'user')
      imageParts(m).forEach((c, i) => {
        const url = c.image_url?.url
        if (url) out.set(`${m.id}.${i}`, url)
      })
  return out
}

/**
 * What changed between the conversation the viewers have and `msgs`:
 * messages replaced (`set`) and appended (`add`), or null when it's more than
 * that (a deleted or reordered message, another chat): send it whole then.
 */
export function diffMessages(
  sentIds: string[],
  sent: string[],
  msgs: MirrorMessage[],
  json: string[]
): { set: MirrorMessage[]; add: MirrorMessage[] } | null {
  if (msgs.length < sentIds.length) return null
  const set: MirrorMessage[] = []
  for (let i = 0; i < sentIds.length; i++) {
    if (msgs[i].id !== sentIds[i]) return null
    if (json[i] !== sent[i]) set.push(msgs[i])
  }
  if (set.length > 4) return null
  return { set, add: msgs.slice(sentIds.length) }
}

/** A screenshot made small enough to send quickly, as a JPEG data URL. */
async function shrinkImage(url: string): Promise<string | null> {
  if (/^https?:\/\//.test(url)) return url
  if (!url.startsWith('data:image/') || typeof Image === 'undefined')
    return null
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(
      1,
      IMAGE_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight, 1)
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.8, 0.6, 0.4]) {
      const out = canvas.toDataURL('image/jpeg', quality)
      if (out.length <= IMAGE_MAX_CHARS) return out
    }
    return null
  } catch {
    return null
  }
}

// useChat hands each piece of a reply to the mirror as it arrives (see
// mirrorStreamTap), so it goes out at once: not when Hi-chat next draws a
// frame, which a covered or hidden window barely does
let tap: ((threadId: string, text: string) => void) | null = null

/** A reply's whole text so far, as it arrives from the model. */
export function mirrorStreamTap(threadId: string, text: string) {
  tap?.(threadId, text)
}

// The chat reports how much of a reply's answer it shows each time it
// reveals more (ThreadContent), so viewers show exactly that, in step
let shownTap: ((threadId: string, id: string, n: number) => void) | null = null

/** How many characters of a reply's answer Hi-chat shows right now. */
export function mirrorShownTap(threadId: string, id: string, n: number) {
  shownTap?.(threadId, id, n)
}

/** How Hi-chat looks, so /mirror can look the same. */
export type MirrorLook = {
  t: 'look'
  /** The chat column's width, in px */
  width: number
  dark: boolean
  /** Hi-chat's CSS variables (colours, font, font size) */
  vars: Record<string, string>
}

/** Reads how the chat looks: the page's own CSS variables and its column. */
export function readLook(root: HTMLElement, scroller: HTMLElement): MirrorLook {
  const vars: Record<string, string> = {}
  for (let i = 0; i < root.style.length; i++) {
    const k = root.style[i]
    if (k.startsWith('--')) vars[k] = root.style.getPropertyValue(k).trim()
  }
  const column = scroller.firstElementChild as HTMLElement | null
  return {
    t: 'look',
    width: Math.round(column?.clientWidth ?? 0),
    dark: root.classList.contains('dark'),
    vars,
  }
}

/**
 * Where the chat is scrolled to: at the bottom, or at a message (`id`) and how
 * far into it the top of the view is (`f`, 0 to 1). By message rather than in
 * pixels, as the viewer's text wraps at its own width.
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

const AT_BOTTOM_PX = 40
const MESSAGE = '[data-test-id^="message-"]'

/** Reads where the chat's scroll area (`[data-thread-scroller]`) is. */
export function readScroll(el: HTMLElement): MirrorScroll {
  // The message at the top of the view, and exactly where in it the view
  // starts, even at the end of the chat: a viewer placed the same way shows
  // the same lines, so a scroll near the end doesn't flip it to "the end"
  // (laid out differently there) and back
  const top = el.getBoundingClientRect().top
  for (const m of el.querySelectorAll<HTMLElement>(MESSAGE)) {
    const r = m.getBoundingClientRect()
    if (r.bottom <= top) continue
    const id = (m.dataset.testId ?? '').replace(/^message-[a-z]+-/, '')
    const f =
      r.height > 0 ? Math.min(1, Math.max(0, (top - r.top) / r.height)) : 0
    return {
      t: 'scroll',
      id,
      f: Math.round(f * 1000) / 1000,
      px: Math.round(top - r.top),
      h: Math.round(r.height),
    }
  }
  if (el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX)
    return { t: 'scroll', bottom: true }
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
  role: 'send' | 'view',
  link?: string,
  born?: number
) {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base = `${scheme}//${location.host}`
  const secret = link ? encodeURIComponent(link) : ''
  // A link's viewer has no login: it watches through the link's own socket
  if (role === 'view' && link) return `${base}/api/mirror-link?link=${secret}`
  // The app says when it made its link, so the server ends it on time
  const since = link && born !== undefined ? `&born=${Math.floor(born)}` : ''
  return `${base}/api/mirror?role=${role}${link ? `&link=${secret}` : ''}${since}`
}

/** The Mac app's bridge to its page, when this page is in the Mac app. */
function nativeBridge(): { postMessage(m: unknown): void } | null {
  const w = globalThis as {
    webkit?: {
      messageHandlers?: { hiChat?: { postMessage(m: unknown): void } }
    }
    navigator?: Navigator
  }
  if (!/HiChatMac/.test(w.navigator?.userAgent ?? '')) return null
  return w.webkit?.messageHandlers?.hiChat ?? null
}

const CODE_TOAST = 'mirror-control-code'

/** Shows the code a mirror link's viewer types to control this Mac. */
function showControlCode(code: string | null) {
  if (!code) return toast.dismiss(CODE_TOAST)
  toast(`Mirror control code: ${code}`, {
    id: CODE_TOAST,
    description:
      'Someone on a mirror link asked to control this Mac. Give them this code only if you trust them.',
    duration: CODE_TTL_MS,
  })
}

/** Starts sending; returns a function that stops it. */
export function startRemoteMirror({
  WebSocketImpl = globalThis.WebSocket,
  location = globalThis.location,
  PeerConnection = globalThis.RTCPeerConnection,
}: {
  WebSocketImpl?: typeof WebSocket
  location?: Location
  PeerConnection?: typeof RTCPeerConnection
} = {}): () => void {
  if (
    !WebSocketImpl ||
    !location ||
    !/^https?:$/.test(location.protocol) ||
    notSending(location.pathname)
  )
    return () => {}

  let ws: WebSocket | null = null
  let stopped = false
  let viewers = 0
  // The link this app last connected with
  let sentLink: string | null = null
  let retryMs = 1000
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let queued = false
  // What the viewers already have
  let snapKey: unknown[] = []
  let sentThread: string | null | undefined
  let sentTitle = ''
  let sentIds: string[] = []
  let sentJson: string[] = []
  let sentImages = new Set<string>()
  let sentPhase: string | null | undefined
  let sentStream: { id: string | null; text: string } = { id: null, text: '' }
  let sentScroll = ''
  let sentLook = ''
  // What the viewers have in the message box (a new one starts empty)
  let sentTyping: string | undefined = ''
  let scrollFrame: number | undefined
  let streamCount = 0
  // The reply viewers follow, and how much of it they were told is shown
  let shownId: string | null = null
  let sentShown = -1
  // While someone watches, a held Web Lock keeps Chrome from freezing or
  // discarding this tab when it is in the background
  let releaseAwake: (() => void) | undefined
  const stayAwake = (on: boolean) => {
    if (!on) {
      releaseAwake?.()
      releaseAwake = undefined
      return
    }
    const locks = globalThis.navigator?.locks
    if (releaseAwake || !locks) return
    const held = new Promise<void>((resolve) => (releaseAwake = resolve))
    locks
      .request(
        `hichat-mirror-${Math.random().toString(36).slice(2)}`,
        () => held
      )
      .catch(() => {})
  }

  const open = () => ws?.readyState === WebSocketImpl.OPEN
  // This page's updates, numbered, so a viewer applies each once whichever
  // way it arrives first (lib/mirrorDirect.ts)
  const session = Math.random().toString(36).slice(2, 12)
  let seq = 0
  // A data channel straight to each viewer, beside the server
  const direct = PeerConnection
    ? createDirectSender({
        PeerConnection,
        signal: (m) => {
          if (open()) ws!.send(JSON.stringify(m))
        },
        // In the Mac app, a signed-in /mirror may control this computer while
        // it is shared: its mouse and key actions go to the app to replay
        canControl: nativeBridge() !== null,
        onInput: (m) => nativeBridge()?.postMessage({ input: m }),
        // A mirror link's viewer asked to control: the code to give them
        onCode: showControlCode,
      })
    : null
  const send = (data: { t: string } & Record<string, unknown>) => {
    if (!open()) return
    if (!SEQUENCED.has(data.t)) return ws!.send(JSON.stringify(data))
    const out = JSON.stringify({ ...data, s: session, q: ++seq })
    // Straight to the viewers first, then the server's copy
    direct?.broadcast(out)
    ws!.send(out)
  }
  /** Everything again, for a new viewer or a window coming to the front. */
  const resend = () => {
    snapKey = []
    sentThread = undefined
    sentImages = new Set()
    sentPhase = undefined
    sentStream = { id: null, text: '' }
    sentScroll = ''
    sentShown = -1
    sentLook = ''
    sentTyping = ''
  }

  // The reply being written. The chat gives it a new id on every update (and
  // the saved reply another), so a reply is followed by its text: text that
  // carries on from what the viewers have is the same reply, sent as an add
  function sendStream(text: string | null, liveId?: string) {
    const id =
      text === null
        ? null
        : sentStream.id !== null && text.startsWith(sentStream.text)
          ? sentStream.id
          : (liveId ?? `reply-${++streamCount}`)
    if (id !== null && id !== shownId) {
      shownId = id
      sentShown = -1
    }
    const update = streamUpdate(sentStream, id, text ?? '')
    if (update) {
      send(update as { t: string })
      sentStream = { id, text: id === null ? '' : (text ?? '') }
    }
  }

  // Each piece of a reply, straight from the model (useChat)
  tap = (threadId, text) => {
    if (!viewers || !open() || notSending(location.pathname)) return
    if (threadId !== useThreads.getState().currentThreadId) return
    // Under the reply's own id, which the saved reply keeps, so the viewer
    // carries on with the same answer when it finishes instead of drawing it
    // again
    const live = useAppState.getState().streamingContent
    sendStream(text, live?.thread_id === threadId ? live.id : undefined)
  }

  // How much of the reply Hi-chat shows: sent each time it reveals more, for
  // the reply being written (and its last words after it is saved). Not from
  // a background window, which barely draws; viewers pace it themselves then
  shownTap = (threadId, id, n) => {
    if (!viewers || !open() || notSending(location.pathname)) return
    if (id !== shownId || n === sentShown) return
    if (globalThis.document?.hidden) return
    if (threadId !== useThreads.getState().currentThreadId) return
    sentShown = n
    send({ t: 'shown', id, n })
  }

  // Screenshots, sent once each, made small first
  function sendImages(messages: ThreadMessage[]) {
    for (const [key, url] of messageImages(messages)) {
      if (sentImages.has(key)) continue
      sentImages.add(key)
      const viewersWere = sentImages
      shrinkImage(url).then((src) => {
        // Not if a new viewer started over meanwhile (it gets it again)
        if (src && sentImages === viewersWere) send({ t: 'img', key, src })
      })
    }
  }

  function push() {
    queued = false
    if (!viewers || !open()) return
    if (notSending(location.pathname)) return
    const app = useAppState.getState()
    // With Hi-chat open in several windows, the one in front speaks; one in
    // the background only finishes a reply it is writing
    if (
      globalThis.document?.hidden &&
      !app.streamingContent &&
      sentStream.id === null
    )
      return
    const threadId = useThreads.getState().currentThreadId ?? null
    const title = threadId
      ? (useThreads.getState().threads[threadId]?.title ?? '')
      : ''
    const messages = threadId
      ? useMessages.getState().messages[threadId]
      : undefined
    // Rebuild only when the conversation changed, not on every streamed word
    const key = [threadId, title, messages]
    const changed = key.some((v, i) => v !== snapKey[i])
    if (changed) {
      snapKey = key
      const msgs = mirrorMessages(messages ?? [])
      const json = msgs.map((m) => JSON.stringify(m))
      const ops =
        sentThread === threadId
          ? diffMessages(sentIds, sentJson, msgs, json)
          : null
      if (!ops) send({ t: 'snap', title, msgs })
      else if (ops.set.length || ops.add.length || title !== sentTitle)
        send({ t: 'ops', title, ...ops })
      sentThread = threadId
      sentTitle = title
      sentIds = msgs.map((m) => m.id)
      sentJson = json
      sendImages(messages ?? [])
    }
    // Accuracy mode's progress, as Hi-chat shows it
    const phase =
      threadId && app.accuracyStatus?.threadId === threadId
        ? app.accuracyStatus.phase
        : null
    // (A viewer starts with none, so only a change is worth sending)
    if (phase !== (sentPhase ?? null)) {
      send({ t: 'phase', phase })
      sentPhase = phase
    }
    const live =
      app.streamingContent && threadId
        ? app.streamingContent.thread_id === threadId
          ? app.streamingContent
          : undefined
        : undefined
    // What's being typed in the message box
    const typing = usePrompt.getState().prompt
    if (typing !== sentTyping) {
      send({ t: 'typing', text: typing.slice(0, 20_000) })
      sentTyping = typing
    }
    if (!live) sendStream(null)
    else {
      const text = messageText(live)
      // The model's own pieces (tap) are usually ahead of what Hi-chat has
      // drawn: nothing to send then
      if (
        !(
          sentStream.id !== null &&
          sentStream.text.startsWith(text) &&
          sentStream.text.length >= text.length
        )
      )
        sendStream(text, live.id)
    }
    // Where the chat is scrolled to: measuring it makes the browser lay the
    // chat out again, so not on every streamed piece (several a frame), only
    // when the conversation changed or a viewer starts over, and on the next
    // frame, once Hi-chat has drawn the change. Scrolling sends it itself
    if (changed || sentScroll === '') scrollSoon()
  }

  const scrollSoon = () => {
    if (scrollFrame) return
    scrollFrame = globalThis.requestAnimationFrame
      ? globalThis.requestAnimationFrame(sendScroll)
      : (setTimeout(sendScroll, 16) as unknown as number)
  }

  // Where the chat is scrolled to, so the viewer scrolls with it
  function sendScroll() {
    scrollFrame = undefined
    if (!viewers || !open()) return
    if (globalThis.document?.hidden) return
    const scroller = globalThis.document?.querySelector<HTMLElement>(
      '[data-thread-scroller]'
    )
    if (!scroller) return
    // How it looks (theme, font, size, the column's width): read here, with
    // the scroll, as it also lays the page out
    const root = globalThis.document?.documentElement
    if (root) {
      const look = readLook(root, scroller)
      const key = JSON.stringify(look)
      if (key !== sentLook) {
        sentLook = key
        send(look)
      }
    }
    const at = readScroll(scroller)
    const scroll = JSON.stringify(at)
    if (scroll !== sentScroll) {
      sentScroll = scroll
      send(at)
    }
  }

  // Changes go out together, right after the change that caused them: a
  // microtask, which (unlike a timer) a background window doesn't slow down
  const schedule = () => {
    if (!viewers || queued) return
    queued = true
    queueMicrotask(push)
  }

  function connect() {
    if (stopped) return
    // Signed in, so it also sends to this app's own link
    sentLink = mirrorLinkSecret()
    const socket = new WebSocketImpl(
      mirrorSocketUrl(location, 'send', sentLink, mirrorLinkBorn())
    )
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
      // Setting up direct channels with viewers
      if (m.t === 'peer' || m.t === 'rtc') return direct?.receive(m)
      if (m.t !== 'viewers' || typeof m.n !== 'number') return
      const had = viewers
      viewers = m.n
      stayAwake(viewers > 0)
      // A new viewer starts from the whole conversation
      if (viewers > had) {
        resend()
        schedule()
      }
    }
    socket.onclose = () => {
      if (ws !== socket) return
      ws = null
      viewers = 0
      stayAwake(false)
      // The server introduces the viewers again on reconnecting
      direct?.closeAll()
      if (stopped) return
      retryTimer = setTimeout(connect, retryMs)
      retryMs = Math.min(retryMs * 2, 30_000)
    }
  }

  // Coming to the front: send this window's conversation in full
  const onVisible = () => {
    if (globalThis.document?.hidden) return
    resend()
    // Another window may have been typing: send this one's box either way
    sentTyping = undefined
    schedule()
  }
  globalThis.document?.addEventListener('visibilitychange', onVisible)
  // Scrolling the chat (scroll events don't bubble, so listen while capturing)
  const onScroll = (e: Event) => {
    const target = e.target as HTMLElement | null
    // Sent on the next frame rather than batched, so the viewer keeps up
    if (target?.matches?.('[data-thread-scroller]')) scrollSoon()
  }
  globalThis.document?.addEventListener('scroll', onScroll, true)
  // A new theme, font or size, or a resized window: send how it looks
  const onResize = () => scrollSoon()
  globalThis.addEventListener?.('resize', onResize)
  const root = globalThis.document?.documentElement
  const looks =
    root && typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => viewers && scrollSoon())
      : null
  if (root)
    looks?.observe(root, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
  const unsubscribe = [
    useMessages.subscribe(schedule),
    useThreads.subscribe(schedule),
    useAppState.subscribe(schedule),
    usePrompt.subscribe(schedule),
    () => globalThis.removeEventListener?.('resize', onResize),
    () => looks?.disconnect(),
    () =>
      globalThis.document?.removeEventListener('visibilitychange', onVisible),
    () => globalThis.document?.removeEventListener('scroll', onScroll, true),
  ]
  // Connect again at once, for a new link
  const reconnect = () => {
    const was = ws
    ws = null
    viewers = 0
    direct?.closeAll()
    was?.close()
    clearTimeout(retryTimer)
    connect()
  }
  // "New link": end the old one, then send on the new
  unsubscribe.push(
    onMirrorLinkRenewed((old) => {
      send({ t: 'revoke', link: old })
      reconnect()
    })
  )
  const ping = setInterval(() => send({ t: 'ping' }), PING_MS)
  // The link ran out (90 minutes), or another window replaced it: end the
  // old one and send on the new
  const linkCheck = setInterval(() => {
    const was = sentLink
    if (!was || mirrorLinkSecret() === was) return
    send({ t: 'revoke', link: was })
    reconnect()
  }, LINK_CHECK_MS)
  connect()

  return () => {
    stopped = true
    tap = null
    shownTap = null
    stayAwake(false)
    unsubscribe.forEach((u) => u())
    clearInterval(ping)
    clearInterval(linkCheck)
    clearTimeout(retryTimer)
    direct?.closeAll()
    ws?.close()
    ws = null
  }
}

// Viewing side (containers/MirrorView.tsx)

type Stream = { id: string; text: string } | null
export type MirrorState = {
  title: string
  msgs: MirrorMessage[]
  stream: Stream
  senderOn: boolean
  /** Where Hi-chat is scrolled to; a new object for each move */
  scroll:
    | { bottom: true }
    | { id: string; f: number; px?: number; h?: number }
    | null
  /** Screenshots messages show, by key */
  images: Record<string, string>
  /** Accuracy mode's progress, while it runs */
  phase: 'searching' | 'drafting' | 'verifying' | null
  /** How much of a reply's answer Hi-chat shows right now */
  shown: { id: string; n: number } | null
  /** How Hi-chat looks */
  look: Omit<MirrorLook, 't'> | null
  /** What is in Hi-chat's message box */
  typing: string
}

export const emptyMirror: MirrorState = {
  title: '',
  msgs: [],
  stream: null,
  senderOn: false,
  scroll: null,
  images: {},
  phase: null,
  shown: null,
  look: null,
  typing: '',
}

const PHASES = ['searching', 'drafting', 'verifying'] as const

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
  // Only what changed: messages replaced (set) and appended (add). Messages
  // that didn't change keep their objects, so they aren't drawn again
  if (m?.t === 'ops') {
    const msgs = state.msgs.slice()
    for (const x of (Array.isArray(m.set) ? m.set : []) as MirrorMessage[]) {
      const i = msgs.findIndex((y) => y.id === x.id)
      if (i !== -1) msgs[i] = x
    }
    msgs.push(...((Array.isArray(m.add) ? m.add : []) as MirrorMessage[]))
    const stream =
      state.stream && endsStream(msgs, state.stream) ? null : state.stream
    return {
      ...state,
      title: typeof m.title === 'string' ? m.title : state.title,
      msgs,
      stream,
    }
  }
  if (m?.t === 'img' && typeof m.key === 'string' && typeof m.src === 'string')
    return { ...state, images: { ...state.images, [m.key]: m.src } }
  if (m?.t === 'phase')
    return {
      ...state,
      phase: (PHASES as readonly string[]).includes(m.phase) ? m.phase : null,
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
  if (m?.t === 'shown') {
    if (typeof m.id !== 'string' || !Number.isSafeInteger(m.n)) return state
    // Never back: a copy arriving late by the other route says less
    const same = state.shown?.id === m.id
    const n = same ? Math.max(state.shown!.n, m.n) : m.n
    if (same && n === state.shown!.n) return state
    return { ...state, shown: { id: m.id, n } }
  }
  if (m?.t === 'look' && m.vars && typeof m.vars === 'object') {
    const vars: Record<string, string> = {}
    for (const [k, v] of Object.entries(m.vars))
      if (/^--[\w-]+$/.test(k) && typeof v === 'string' && !/url\(/i.test(v))
        vars[k] = v
    return {
      ...state,
      look: {
        width: typeof m.width === 'number' && m.width > 0 ? m.width : 0,
        dark: m.dark === true,
        vars,
      },
    }
  }
  if (m?.t === 'typing' && typeof m.text === 'string')
    return m.text === state.typing ? state : { ...state, typing: m.text }
  if (m?.t === 'sender') return { ...state, senderOn: m.on === true }
  if (m?.t === 'scroll') {
    if (m.bottom === true) return { ...state, scroll: { bottom: true } }
    if (typeof m.id === 'string' && typeof m.f === 'number') {
      const exact =
        Number.isFinite(m.px) && Number.isFinite(m.h) && m.h > 0
          ? { px: m.px as number, h: m.h as number }
          : {}
      return {
        ...state,
        scroll: { id: m.id, f: Math.min(1, Math.max(0, m.f)), ...exact },
      }
    }
  }
  return state
}
