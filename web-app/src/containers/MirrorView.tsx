import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import {
  IconArrowDown,
  IconGripVertical,
  IconLayoutSidebarRightCollapse,
  IconLoader2,
  IconMaximize,
  IconMessageCircle,
  IconPencil,
  IconScreenShare,
  IconTool,
  IconVideo,
  IconVolume,
  IconVolumeOff,
} from '@tabler/icons-react'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { AccuracyProgress } from '@/containers/AccuracyProgress'
import { AccuracyReviewInfo } from '@/containers/ThreadContent'
import ThinkingBlock from '@/containers/ThinkingBlock'
import type { AccuracyReview } from '@/lib/accuracyReview'
import { useSmoothText } from '@/lib/useSmoothText'
import {
  createDirectViewer,
  createSeqFilter,
  type RemoteInput,
} from '@/lib/mirrorDirect'
import {
  createClickCounter,
  keyAction,
  macMods,
  screenPoint,
  wheelPixels,
} from '@/lib/remoteInput'
import { splitReasoning } from '@/lib/splitReasoning'
import type { ScreenStats } from '@/lib/remoteCamera'
import {
  RemoteCameraPanel,
  StatusPill,
  toneDot,
} from '@/containers/RemoteCameraPanel'
import {
  AUTOSTART,
  CAMERA_PANEL,
  cameraState,
  store,
  stored,
  useCameraSender,
} from '@/hooks/useCameraSender'
import {
  applyMirrorMessage,
  emptyMirror,
  mirrorSocketUrl,
  type MirrorMessage as MirrorMessageData,
  type MirrorState,
} from '@/lib/remoteMirror'
import { cn } from '@/lib/utils'

// The remote mirror's viewer: open /mirror on another signed-in computer to
// follow the conversation open in Hi-chat, live (see lib/remoteMirror.ts).
// Its camera panel sends this computer's camera and mic to Meet on the
// computer running Hi-chat (see lib/remoteCamera.ts), and while that computer
// presents in Meet, its shared screen fills the space left of the text.

function useMirror(link?: string) {
  const [state, setState] = useState<MirrorState>(emptyMirror)
  const [connected, setConnected] = useState(false)
  // Round trip to Hi-chat's server, in ms, from the pings below
  const [lag, setLag] = useState<number | null>(null)
  // With a direct channel to Hi-chat open: the round trip over it
  const [directLag, setDirectLag] = useState<number | null>(null)
  const [direct, setDirect] = useState(false)
  // Whether the Hi-chat app at the other end can be controlled from here
  const [controllable, setControllable] = useState(false)
  const sendInputRef = useRef<(m: RemoteInput) => boolean>(() => false)
  const sendInput = useCallback((m: RemoteInput) => sendInputRef.current(m), [])

  useEffect(() => {
    let ws: WebSocket | null = null
    let stopped = false
    let retryMs = 1000
    let retry: ReturnType<typeof setTimeout> | undefined
    // Messages wait at most until the next frame, then apply together: a
    // burst of streamed pieces costs one redraw, not one each
    let pending: unknown[] = []
    let frame: number | undefined
    const apply = () => {
      frame = undefined
      const batch = pending
      pending = []
      if (batch.length)
        setState((s) => batch.reduce<MirrorState>(applyMirrorMessage, s))
    }
    const queue = (m: unknown) => {
      pending.push(m)
      if (frame !== undefined) return
      // A hidden page draws no frames; apply soon anyway
      frame = document.hidden
        ? (setTimeout(apply, 50) as unknown as number)
        : requestAnimationFrame(apply)
    }
    // Each update once, from whichever route can bring it first: usually the
    // direct channel to Hi-chat, else Hi-chat's server (lib/mirrorDirect.ts)
    const seq = createSeqFilter()
    const peer = createDirectViewer({
      signal: (m) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
      },
      onMessage: (m) => {
        for (const x of seq.take(m, 'direct')) queue(x)
      },
      onPong: (n) =>
        setDirectLag(Math.max(0, Math.round(performance.now() - n))),
      onChange: (open) => {
        setDirect(open > 0)
        if (!open) setDirectLag(null)
      },
      onControl: setControllable,
    })
    sendInputRef.current = (m) => peer.sendInput(m)
    const ping = () => {
      const n = performance.now()
      peer.ping(n)
      // The server too: it keeps the socket open, and is the fallback
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ t: 'ping', n }))
    }
    const connect = () => {
      const socket = new WebSocket(
        mirrorSocketUrl(window.location, 'view', link)
      )
      ws = socket
      socket.onopen = () => {
        retryMs = 1000
        setConnected(true)
        ping()
      }
      socket.onmessage = (e) => {
        let m: { t?: string; n?: number }
        try {
          m = JSON.parse(String(e.data))
        } catch {
          return // not a mirror message
        }
        if (m.t === 'pong') {
          if (typeof m.n === 'number')
            setLag(Math.max(0, Math.round(performance.now() - m.n)))
          return
        }
        // Hi-chat offering a direct channel
        if (m.t === 'rtc') return peer.receive(m)
        for (const x of seq.take(m, 'relay')) queue(x)
      }
      socket.onclose = () => {
        if (ws !== socket) return
        setConnected(false)
        setLag(null)
        // Hi-chat offers again once the server introduces us again
        peer.closeAll()
        if (stopped) return
        retry = setTimeout(connect, retryMs)
        retryMs = Math.min(retryMs * 2, 15_000)
      }
    }
    // After a gap (Wi-Fi back, the laptop waking), connect again at once:
    // the server sends everything current, rather than waiting for a socket
    // that may already be dead to notice
    const fresh = () => {
      clearTimeout(retry)
      retryMs = 1000
      const was = ws
      ws = null
      was?.close()
      connect()
    }
    let hiddenAt = 0
    const onVisibility = () => {
      if (document.hidden) hiddenAt = Date.now()
      else if (hiddenAt && Date.now() - hiddenAt > 20_000) fresh()
    }
    window.addEventListener('online', fresh)
    document.addEventListener('visibilitychange', onVisibility)
    connect()
    // Often enough to show a current lag, and to keep the socket open
    const pinger = setInterval(ping, 5_000)
    return () => {
      stopped = true
      clearInterval(pinger)
      clearTimeout(retry)
      if (frame !== undefined) {
        cancelAnimationFrame(frame)
        clearTimeout(frame)
      }
      window.removeEventListener('online', fresh)
      document.removeEventListener('visibilitychange', onVisibility)
      peer.closeAll()
      ws?.close()
    }
  }, [link])

  // Keep the screen (and so the mirror) awake while this page is open
  useEffect(() => {
    let lock: WakeLockSentinel | undefined
    const take = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        ?.request('screen')
        .then((l) => (lock = l))
        .catch(() => {})
    }
    take()
    document.addEventListener('visibilitychange', take)
    return () => {
      document.removeEventListener('visibilitychange', take)
      lock?.release().catch(() => {})
    }
  }, [])

  return {
    state,
    connected,
    lag: direct ? (directLag ?? lag) : lag,
    direct,
    controllable,
    sendInput,
  }
}

/**
 * The mirror page: signed in at /mirror (every app's conversation, the one in
 * front showing), or through an app's own link at /m/<link> without login.
 */
export function MirrorViewer({ link }: { link?: string } = {}) {
  const { state, connected, lag, direct, controllable, sendInput } =
    useMirror(link)
  const cam = useCameraSender({ link })
  // Open as last left; at first, open on a computer that sends its camera
  const [panelOpen, setPanelOpen] = useState(() => {
    const saved = stored(CAMERA_PANEL)
    return saved ? saved === '1' : stored(AUTOSTART) === '1'
  })
  const togglePanel = () =>
    setPanelOpen((open) => {
      store(CAMERA_PANEL, open ? '0' : '1')
      return !open
    })

  const scroller = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const [showJump, setShowJump] = useState(false)

  // The scroll position that shows the end of the conversation at the bottom
  // of the view. Blank room follows it, so the last answer can be scrolled up
  // further, but following the end stops here rather than in the blank
  const endScroll = (el: HTMLElement) => {
    const mark = end.current
    if (!mark) return el.scrollHeight
    const top =
      mark.getBoundingClientRect().top -
      el.getBoundingClientRect().top +
      el.scrollTop
    return Math.max(0, top + 24 - el.clientHeight)
  }

  // Scrolling here yourself takes over until Hi-chat scrolls again
  const following = useRef(true)
  const placed = useRef(-1) // scrollTop this page set last

  // Follow Hi-chat's scroll: to the same message and point in it, or the end
  useLayoutEffect(() => {
    following.current = true
  }, [state.scroll])
  // Where the followed message sits on screen. Hi-chat sends a point in a
  // message only when it scrolls; while an answer grows its screen stays put,
  // so between scrolls this page keeps that message where it was rather than
  // working the point out again from a height that keeps changing (which
  // drifted the page with every word)
  const pinned = useRef<{ scroll: unknown; id: string; top: number } | null>(
    null
  )
  const follow = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const at = state.scroll
    if (following.current && at && 'id' in at) {
      const m = el.querySelector<HTMLElement>(
        `[data-mid="${CSS.escape(at.id)}"]`
      )
      if (m) {
        const box = el.getBoundingClientRect().top
        const top = m.getBoundingClientRect().top - box + el.scrollTop
        const pin = pinned.current
        el.scrollTop =
          pin && pin.scroll === at && pin.id === at.id
            ? top - pin.top
            : top + at.f * m.offsetHeight - 16
        placed.current = el.scrollTop
        pinned.current = { scroll: at, id: at.id, top: top - el.scrollTop }
        atBottom.current = false
        return
      }
    }
    if ((following.current && at) || atBottom.current) {
      el.scrollTop = endScroll(el)
      placed.current = el.scrollTop
      atBottom.current = true
      setShowJump(false)
    } else setShowJump(true)
  }, [state.scroll])
  useLayoutEffect(follow, [state.msgs, state.stream, state.scroll, follow])
  // An answer keeps growing between updates (it is revealed a little each
  // frame), so follow its height too, not only the updates
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = content.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => follow())
    watch.observe(el)
    return () => watch.disconnect()
  }, [follow])

  const jumpToLatest = () => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ top: endScroll(el), behavior: 'smooth' })
    atBottom.current = true
    setShowJump(false)
  }

  const streaming =
    state.stream && !state.msgs.some((m) => m.id === state.stream?.id)
      ? state.stream
      : null
  // Live, with the round trip: straight to Hi-chat when a direct channel is
  // open ("Direct"), else to the server; amber when it's slow
  const via = direct ? 'Direct' : 'Live'
  const mirror = !connected
    ? { label: 'Reconnecting…', tone: 'waiting' as const }
    : !state.senderOn
      ? { label: "Hi-chat isn't open", tone: 'off' as const }
      : lag === null
        ? { label: via, tone: 'live' as const }
        : {
            label: `${via} · ${lag} ms`,
            tone: lag > 400 ? ('waiting' as const) : ('live' as const),
          }
  const camera = cameraState(cam)
  // The Meet call's sound: on unless muted here (remembered)
  const [callMuted, setCallMuted] = useState(() => stored(CALL_MUTED) === '1')
  const [callBlocked, setCallBlocked] = useState(false)
  const blockCall = useCallback(() => setCallBlocked(true), [])
  const empty = state.msgs.length === 0 && !streaming

  // On a laptop the shared screen sits left of the text, sized by a divider
  // you can drag; the text stays centred unless the screen would cover it
  const body = useRef<HTMLDivElement>(null)
  const wide = useWide()
  const [bodyWidth, setBodyWidth] = useState(0)
  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    const watch = new ResizeObserver(() => setBodyWidth(el.clientWidth))
    watch.observe(el)
    setBodyWidth(el.clientWidth)
    return () => watch.disconnect()
  }, [])
  const [split, setSplit] = useState<number | null>(() => {
    const saved = Number(stored(SPLIT))
    return saved > 0 && saved < 1 ? saved : null
  })
  const right = panelOpen ? PANEL_WIDTH : 0
  const screenWidth = cam.screen
    ? clampScreen(
        split === null ? (bodyWidth - TEXT_WIDTH) / 2 - GAP : split * bodyWidth,
        bodyWidth,
        right
      )
    : 0
  const textLeft = Math.max(
    screenWidth ? screenWidth + GAP : 0,
    (bodyWidth - TEXT_WIDTH) / 2
  )
  const text =
    wide && bodyWidth
      ? {
          width: Math.max(
            MIN_TEXT,
            Math.min(TEXT_WIDTH, bodyWidth - right - GAP - textLeft)
          ),
          marginLeft: textLeft,
        }
      : undefined

  return (
    <div className="flex h-full flex-col bg-main-view text-main-view-fg">
      <header className="flex items-center gap-3 border-b border-main-view-fg/10 bg-main-view/80 px-4 py-2.5 backdrop-blur">
        <img
          src="/images/hi-chat-logo.png"
          alt=""
          className="size-7 shrink-0 rounded-md"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] font-medium uppercase tracking-wider text-main-view-fg/45">
            Hi-chat mirror
          </span>
          <h1 className="truncate text-sm font-semibold leading-tight">
            {state.title || 'Conversation'}
          </h1>
        </div>
        <StatusPill
          tone={mirror.tone}
          label={mirror.label}
          className="hidden sm:inline-flex"
        />
        {cam.call &&
          (callBlocked ? (
            <button
              type="button"
              onClick={() => setCallBlocked(false)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-medium text-accent-fg"
            >
              <IconVolume size={16} />
              Click to hear the call
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                setCallMuted((m) => {
                  store(CALL_MUTED, m ? null : '1')
                  return !m
                })
              }
              aria-pressed={!callMuted}
              title={
                callMuted ? "Play the call's sound" : "Mute the call's sound"
              }
              className={cn(
                'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                callMuted
                  ? 'border-main-view-fg/10 text-main-view-fg/50 hover:bg-main-view-fg/[0.04]'
                  : 'border-main-view-fg/20 bg-main-view-fg/[0.06]'
              )}
            >
              {callMuted ? (
                <IconVolumeOff size={16} />
              ) : (
                <IconVolume size={16} />
              )}
              <span className="hidden sm:inline">Call</span>
            </button>
          ))}
        {cam.call && (
          <CallSound
            stream={cam.call}
            muted={callMuted}
            blocked={callBlocked}
            onBlocked={blockCall}
          />
        )}
        <button
          type="button"
          onClick={togglePanel}
          aria-expanded={panelOpen}
          aria-controls="mirror-camera-panel"
          title={panelOpen ? 'Hide the camera panel' : 'Show the camera panel'}
          className={cn(
            'relative inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
            panelOpen
              ? 'border-main-view-fg/20 bg-main-view-fg/[0.06]'
              : 'border-main-view-fg/10 hover:bg-main-view-fg/[0.04]'
          )}
        >
          {panelOpen ? (
            <IconLayoutSidebarRightCollapse size={16} />
          ) : (
            <IconVideo size={16} />
          )}
          <span className="hidden sm:inline">Camera</span>
          <span
            className={cn('size-2 rounded-full', toneDot[camera.tone])}
            aria-label={camera.label}
          />
        </button>
      </header>

      {/* On a laptop: the shared screen on the left (with its divider), the
          text centred, the camera panel on the right. The conversation scrolls
          across the whole width beneath them; on a phone they stack */}
      <div ref={body} className="relative flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* On a phone the header has no room for the mirror's status */}
          <div className="flex justify-center border-b border-main-view-fg/5 py-1.5 sm:hidden">
            <StatusPill tone={mirror.tone} label={mirror.label} />
          </div>
          <div
            ref={scroller}
            className="flex-1 overflow-y-auto px-4 py-6 lg:px-0"
            onScroll={(e) => {
              const el = e.currentTarget
              if (Math.abs(el.scrollTop - placed.current) > 2)
                following.current = false
              // At the end, or past it in the blank room
              atBottom.current = el.scrollTop >= endScroll(el) - 40
              if (atBottom.current) setShowJump(false)
            }}
          >
            {/* A comfortable reading width; beside a shared screen the half
                is narrower than this anyway */}
            <div
              ref={content}
              style={text}
              className="mx-auto flex max-w-md flex-col gap-6 text-base lg:mx-0 lg:max-w-none"
            >
              {empty && <EmptyState tone={mirror.tone} />}
              {/* The reply being written sits in the list under the id the
                  saved reply keeps, so when it finishes the same answer
                  carries on rather than being drawn again */}
              {[
                ...state.msgs.map((m) => (
                  <MirrorMessage
                    key={m.id}
                    msg={m}
                    images={m.images?.map((k) => state.images[k])}
                  />
                )),
                streaming && (
                  <MirrorMessage
                    key={streaming.id}
                    msg={streamingMsg(streaming)}
                    streaming
                  />
                ),
              ]}
              {/* Accuracy mode's progress, as Hi-chat shows it */}
              {state.phase && !streaming && (
                <AccuracyProgress phase={state.phase} />
              )}
              <div ref={end} aria-hidden />
              {/* Room to scroll the last answer up the page */}
              <div aria-hidden className="h-[60vh] shrink-0" />
            </div>
          </div>
          {showJump && (
            <button
              type="button"
              onClick={jumpToLatest}
              className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-main-view-fg/10 bg-main-view px-3 py-1.5 text-xs font-medium shadow-md transition hover:bg-main-view-fg/[0.04]"
            >
              <IconArrowDown size={14} />
              Latest
            </button>
          )}
        </div>

        {/* While the computer in Meet presents, its screen fills the left */}
        {cam.screen && (
          <SharedScreen
            stream={cam.screen}
            width={wide ? screenWidth : undefined}
            canEdit={controllable}
            sendInput={sendInput}
            onEditing={cam.setFastScreen}
            readStats={cam.screenStats}
          />
        )}
        {cam.screen && wide && bodyWidth > 0 && (
          <Divider
            at={screenWidth}
            onMove={(x) =>
              setSplit(clampScreen(x, bodyWidth, right) / bodyWidth)
            }
            onDone={() =>
              setSplit((v) => {
                store(SPLIT, v === null ? null : String(v))
                return v
              })
            }
            onReset={() => {
              store(SPLIT, null)
              setSplit(null)
            }}
            container={body}
          />
        )}

        {panelOpen && (
          <aside
            id="mirror-camera-panel"
            aria-label="Remote camera"
            className="order-first max-h-[55vh] shrink-0 overflow-y-auto border-b border-main-view-fg/10 bg-main-view p-4 lg:absolute lg:inset-y-0 lg:right-0 lg:z-10 lg:max-h-none lg:w-[360px] lg:border-b-0 lg:border-l lg:p-5"
          >
            <RemoteCameraPanel cam={cam} />
          </aside>
        )}
      </div>
    </div>
  )
}

const CALL_MUTED = 'hichat-mirror-call-muted'

/**
 * Plays the Meet call's sound. If the browser wants a click first, says so
 * (`onBlocked`), and plays on the next try (`blocked` going false).
 */
function CallSound({
  stream,
  muted,
  blocked,
  onBlocked,
}: {
  stream: MediaStream
  muted: boolean
  blocked: boolean
  onBlocked: () => void
}) {
  const player = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = player.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    el.muted = muted
    if (!blocked) el.play().catch(() => onBlocked())
    // The lane is set up before any sound: play again when it starts
    const track = stream.getAudioTracks()[0]
    const again = () => el.play().catch(() => {})
    track?.addEventListener('unmute', again)
    return () => track?.removeEventListener('unmute', again)
  }, [stream, muted, blocked, onBlocked])
  return <audio ref={player} autoPlay hidden />
}

const SPLIT = 'hichat-mirror-split' // the screen's share of the width
const TEXT_WIDTH = 448 // the reading column, like Hi-chat's own window
const MIN_TEXT = 300
const PANEL_WIDTH = 360
const GAP = 24
const MIN_SCREEN = 200

/** The screen's width, leaving room for the text and the camera panel. */
function clampScreen(px: number, total: number, right: number) {
  const max = total - right - MIN_TEXT - GAP * 2
  return Math.max(MIN_SCREEN, Math.min(px, Math.max(MIN_SCREEN, max)))
}

/** Whether the page is laid out side by side (Tailwind's lg). */
function useWide() {
  const query = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const list = matchMedia(query)
    const on = () => setWide(list.matches)
    list.addEventListener('change', on)
    return () => list.removeEventListener('change', on)
  }, [])
  return wide
}

/** The bar between the shared screen and the text: drag it left or right. */
function Divider({
  at,
  onMove,
  onDone,
  onReset,
  container,
}: {
  at: number
  onMove: (x: number) => void
  onDone: () => void
  onReset: () => void
  container: RefObject<HTMLDivElement | null>
}) {
  const [dragging, setDragging] = useState(false)
  const x = (e: { clientX: number }) =>
    e.clientX - (container.current?.getBoundingClientRect().left ?? 0)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the shared screen"
      aria-valuenow={Math.round(at)}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
      }}
      onPointerMove={(e) => dragging && onMove(x(e))}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId)
        setDragging(false)
        onDone()
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 96 : 24
        if (e.key === 'ArrowLeft') onMove(at - step)
        else if (e.key === 'ArrowRight') onMove(at + step)
        else return
        e.preventDefault()
        onDone()
      }}
      style={{ left: at }}
      className="group absolute inset-y-0 z-20 flex w-4 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center outline-none"
    >
      <span
        className={cn(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-main-view-fg/15 transition-colors group-hover:bg-accent group-focus-visible:bg-accent',
          dragging && 'bg-accent'
        )}
      />
      <span
        className={cn(
          'relative flex h-10 w-4 items-center justify-center rounded-full border border-main-view-fg/15 bg-main-view text-main-view-fg/60 shadow-sm transition-colors group-hover:border-accent group-hover:text-main-view-fg group-focus-visible:border-accent',
          dragging && 'border-accent text-main-view-fg'
        )}
      >
        <IconGripVertical size={12} />
      </span>
    </div>
  )
}

/**
 * While `on`: this page's mouse over the shared screen, its wheel and its
 * keys go to the computer sharing it (lib/remoteInput.ts). Your own pointer
 * moves at once; the picture follows a moment later. Shift+Esc stops.
 */
function useRemoteControl({
  on,
  video,
  sendInput,
  stop,
}: {
  on: boolean
  video: RefObject<HTMLVideoElement | null>
  sendInput: (m: RemoteInput) => boolean
  stop: () => void
}) {
  const stopRef = useRef(stop)
  stopRef.current = stop
  useEffect(() => {
    const el = video.current
    if (!on || !el) return
    const viewerIsMac = /Mac/.test(navigator.platform || navigator.userAgent)
    const clicks = createClickCounter()
    const held = new Set<number>()
    const at = (e: { clientX: number; clientY: number }) =>
      screenPoint(
        e.clientX,
        e.clientY,
        el.getBoundingClientRect(),
        el.videoWidth,
        el.videoHeight
      )
    const aspect = () =>
      el.videoHeight
        ? Math.round((el.videoWidth / el.videoHeight) * 1000) / 1000
        : 0
    const mouse = (k: string, e: PointerEvent | MouseEvent, extra = {}) => {
      const p = at(e)
      if (!p) return false
      sendInput({ k, ...p, m: macMods(e, viewerIsMac), a: aspect(), ...extra })
      return true
    }
    // Browser button numbers: 0 left, 1 middle, 2 right; the Mac's: 0, 2, 1
    const button = (b: number) => (b === 2 ? 1 : b === 1 ? 2 : 0)
    const onMove = (e: PointerEvent) => {
      mouse('m', e)
    }
    const onDown = (e: PointerEvent) => {
      const p = at(e)
      if (!p) return
      e.preventDefault()
      el.setPointerCapture?.(e.pointerId)
      const b = button(e.button)
      held.add(b)
      mouse('d', e, { b, c: clicks(b, p.x, p.y) })
    }
    const onUp = (e: PointerEvent) => {
      const b = button(e.button)
      if (!held.delete(b)) return
      const p = at(e)
      sendInput({
        k: 'u',
        ...(p ?? {}),
        b,
        m: macMods(e, viewerIsMac),
        a: aspect(),
      })
    }
    const onWheel = (e: WheelEvent) => {
      if (!at(e)) return
      e.preventDefault()
      sendInput({ k: 'w', ...wheelPixels(e), m: macMods(e, viewerIsMac) })
    }
    const noMenu = (e: Event) => e.preventDefault()
    const onKey = (e: KeyboardEvent) => {
      const down = e.type === 'keydown'
      if (down && e.key === 'Escape' && e.shiftKey) {
        e.preventDefault()
        stopRef.current()
        return
      }
      const action = keyAction(e, down, viewerIsMac)
      if (!action) return
      // The keys are the shared computer's now, not this page's
      e.preventDefault()
      e.stopPropagation()
      sendInput(action)
    }
    // Nothing stays held down there when focus leaves here
    const release = () => {
      held.clear()
      sendInput({ k: 'r' })
    }
    const onHidden = () => document.hidden && release()
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('contextmenu', noMenu)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', onHidden)
    // In full screen, Chrome also passes keys like Ctrl+W and Ctrl+T on
    const keyboard = (
      navigator as Navigator & {
        keyboard?: { lock?: () => Promise<void>; unlock?: () => void }
      }
    ).keyboard
    keyboard?.lock?.().catch(() => {})
    return () => {
      release()
      keyboard?.unlock?.()
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('contextmenu', noMenu)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [on, video, sendInput])
}

/** The readout's breakdown, on hover. */
function screenStatsTitle(s: ScreenStats) {
  return [
    `About ${s.estimateMs ?? '?'} ms from a change there to here:`,
    `network ${s.rttMs === null ? '?' : Math.round(s.rttMs / 2)} ms (half of a ${s.rttMs ?? '?'} ms round trip),`,
    `waiting for the next frame ${s.fps ? Math.round(500 / s.fps) : '?'} ms (${s.fps} fps),`,
    `buffer ${s.bufferMs} ms, decode ${s.decodeMs} ms.`,
    s.relay
      ? 'Through a relay server: a direct connection would be quicker.'
      : 'Direct between the two computers.',
  ].join(' ')
}

function SharedScreen({
  stream,
  width,
  canEdit,
  sendInput,
  onEditing,
  readStats,
}: {
  stream: MediaStream
  width?: number
  /** How the picture is arriving, for the readout in its corner */
  readStats: () => Promise<ScreenStats | null>
  /** The Hi-chat app sharing this screen can be controlled from here */
  canEdit: boolean
  sendInput: (m: RemoteInput) => boolean
  /** Editing started or stopped (the picture goes quicker meanwhile) */
  onEditing: (on: boolean) => void
}) {
  const pane = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [picture, setPicture] = useState(false)
  const [editing, setEditing] = useState(false)
  const edit = editing && canEdit
  // How quickly the picture arrives, read every 2 s while it shows
  const [stats, setStats] = useState<ScreenStats | null>(null)
  useEffect(() => {
    if (!picture) return
    let live = true
    const read = () =>
      readStats()
        .then((s) => live && setStats(s))
        .catch(() => {})
    read()
    const timer = setInterval(read, 2000)
    return () => {
      live = false
      clearInterval(timer)
      setStats(null)
    }
  }, [picture, readStats])
  useRemoteControl({
    on: edit,
    video,
    sendInput,
    stop: () => setEditing(false),
  })
  useEffect(() => {
    onEditing(edit)
    return () => onEditing(false)
  }, [edit, onEditing])
  useEffect(() => {
    const el = video.current
    if (!el) return
    setPicture(false)
    el.srcObject = stream
    el.play().catch(() => {})
    // The lane is set up before anything is presented: play again once
    // frames start
    const track = stream.getVideoTracks()[0]
    const again = () => el.play().catch(() => {})
    track?.addEventListener('unmute', again)
    return () => track?.removeEventListener('unmute', again)
  }, [stream])

  return (
    <section
      ref={pane}
      style={width === undefined ? undefined : { width }}
      aria-label="Shared screen"
      className="group relative order-first flex aspect-video shrink-0 items-center justify-center border-b border-main-view-fg/10 bg-neutral-950 lg:absolute lg:inset-y-0 lg:left-0 lg:z-10 lg:aspect-auto lg:border-b-0"
    >
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        onResize={() => setPicture(true)}
        onPlaying={() => setPicture(true)}
        className={cn(
          'size-full object-contain',
          edit && 'cursor-default touch-none select-none'
        )}
      />
      {!picture && (
        <span className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
          Waiting for the picture…
        </span>
      )}
      {edit && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-sky-400"
        />
      )}
      {stats && stats.fps > 0 && (
        <span
          title={screenStatsTitle(stats)}
          className={cn(
            'absolute bottom-3 left-3 rounded-full border border-white/10 bg-black/60 px-2.5 py-1 text-[11px] font-medium tabular-nums text-white/80 backdrop-blur',
            stats.estimateMs !== null &&
              stats.estimateMs > 150 &&
              'text-amber-300'
          )}
        >
          {stats.fps} fps
          {stats.estimateMs !== null && ` · ≈${stats.estimateMs} ms`}
          {stats.relay ? ' · relay' : ' · direct'}
        </span>
      )}
      {canEdit && (
        <button
          type="button"
          aria-pressed={edit}
          title={
            edit
              ? 'Stop editing (Shift+Esc)'
              : 'Edit: use your mouse and keyboard on this screen'
          }
          onClick={() => setEditing((on) => !on)}
          className={cn(
            'absolute right-14 top-3 inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium backdrop-blur transition outline-none focus-visible:ring-2 focus-visible:ring-white/50',
            edit
              ? 'border-sky-300/60 bg-sky-500/90 text-white'
              : 'border-white/10 bg-black/60 text-white/90 hover:bg-black/75'
          )}
        >
          <IconPencil size={14} />
          {edit ? 'Editing · Shift+Esc to stop' : 'Edit'}
        </button>
      )}
      <StatusPill
        tone="live"
        label="Presenting from the call"
        icon={<IconScreenShare size={14} />}
        className="absolute left-3 top-3 border-white/10 bg-black/60 text-white/90 backdrop-blur"
      />
      <button
        type="button"
        title="Full screen"
        aria-label="Show the shared screen full screen"
        onClick={() =>
          document.fullscreenElement
            ? document.exitFullscreen().catch(() => {})
            : pane.current?.requestFullscreen().catch(() => {})
        }
        className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/90 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100 outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        <IconMaximize size={16} />
      </button>
    </section>
  )
}

function EmptyState({ tone }: { tone: 'off' | 'waiting' | 'live' }) {
  const text =
    tone === 'live'
      ? 'No messages yet. The conversation open in Hi-chat shows here as it happens.'
      : tone === 'off'
        ? 'Open Hi-chat on your other computer, and its open conversation shows here live.'
        : 'Connecting to Hi-chat…'
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-main-view-fg/10 bg-main-view-fg/[0.03] text-main-view-fg/50">
        <IconMessageCircle size={22} stroke={1.5} />
      </div>
      <p className="max-w-sm text-sm leading-relaxed text-main-view-fg/55">
        {text}
      </p>
    </div>
  )
}

// Re-rendered only when its own text changes, not on every scroll or word
// elsewhere: rendering a long chat's markdown again would lag the scroll
/**
 * One message, drawn as Hi-chat's chat draws it (ThreadContent): a question
 * with its files and screenshots, an answer with its thinking folded, its
 * Accuracy review and the tools it used. Drawn again only when it changes.
 */
const MirrorMessage = memo(
  function MirrorMessage({
    msg,
    images,
    streaming,
  }: {
    msg: MirrorMessageData
    /** Its screenshots, as they arrive (undefined until then) */
    images?: (string | undefined)[]
    streaming?: boolean
  }) {
    if (msg.role === 'user')
      return (
        <div data-mid={msg.id || undefined} className="w-full">
          {msg.text && (
            <div className="flex w-full justify-end break-words text-start">
              <div className="relative max-w-[90%] rounded-3xl bg-surface px-5 py-2.5 text-main-view-fg">
                <RenderMarkdown content={msg.text} isUser />
              </div>
            </div>
          )}
          {!!msg.files?.length && (
            <div className="mt-2 flex w-full justify-end">
              <div className="flex max-w-[80%] flex-wrap justify-end gap-2">
                {msg.files.map((name, i) => (
                  <span
                    key={i}
                    className="max-w-48 truncate rounded-md border border-main-view-fg/10 bg-main-view-fg/5 px-3 py-2 text-xs"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {!!msg.images?.length && (
            <div className="mt-2 flex w-full justify-end">
              <div className="flex max-w-[90%] flex-wrap justify-end gap-2">
                {msg.images.map((key, i) => (
                  <MirrorImage key={key} src={images?.[i]} />
                ))}
              </div>
            </div>
          )}
        </div>
      )
    return <MirrorAnswer msg={msg} streaming={streaming} />
  },
  // The same message, the same screenshots: nothing to draw again
  (a, b) =>
    a.msg === b.msg &&
    a.streaming === b.streaming &&
    (a.images ?? []).length === (b.images ?? []).length &&
    (a.images ?? []).every((src, i) => src === b.images?.[i])
)

/** The streamed reply's message object, kept while its text is the same. */
const streamMsgs = new WeakMap<object, MirrorMessageData>()
function streamingMsg(s: { id: string; text: string }): MirrorMessageData {
  let m = streamMsgs.get(s)
  if (!m) {
    m = { id: s.id, role: 'assistant', text: s.text }
    streamMsgs.set(s, m)
  }
  return m
}

/**
 * An answer drawn exactly as Hi-chat's chat draws it (ThreadContent): the
 * text revealed at a steady pace rather than in the bursts it arrives in,
 * new words fading in, finished blocks never drawn again, and the same
 * drawing once it is saved, so nothing jumps when it finishes.
 */
function MirrorAnswer({
  msg,
  streaming,
}: {
  msg: MirrorMessageData
  streaming?: boolean
}) {
  const { reasoningSegment, textSegment } = useMemo(
    () => splitReasoning(msg.text),
    [msg.text]
  )
  const answer = useSmoothText(textSegment.replace('</think>', ''), !!streaming)
  return (
    <div data-mid={msg.id || undefined} className="w-full">
      {reasoningSegment && (
        <ThinkingBlock
          id={`mirror-${msg.id || 'streaming'}`}
          text={reasoningSegment}
        />
      )}
      {streaming && !reasoningSegment && !answer.trim() && (
        <span
          aria-label="Answer on its way"
          className="relative flex size-5 items-center justify-center text-main-view-fg/70"
        >
          <span className="absolute inset-0 rounded-full bg-current opacity-15 animate-[breathe_1.8s_ease-in-out_infinite]" />
          <span className="relative size-2 rounded-full bg-current animate-[breathe-core_1.8s_ease-in-out_infinite]" />
        </span>
      )}
      <RenderMarkdown content={answer} streamable isStreaming={!!streaming} />
      {msg.review && (
        <AccuracyReviewInfo review={msg.review as unknown as AccuracyReview} />
      )}
      {!!msg.tools?.length && (
        <div className="mt-2 flex flex-wrap gap-2">
          {msg.tools.map((tool, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-md border border-main-view-fg/10 bg-main-view-fg/5 px-2 py-1 text-xs text-main-view-fg/70"
            >
              {tool.pending ? (
                <IconLoader2 size={12} className="animate-spin" />
              ) : (
                <IconTool size={12} />
              )}
              {tool.name || 'Tool'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** A screenshot: small like Hi-chat's, full width with a click. */
function MirrorImage({ src }: { src?: string }) {
  const [big, setBig] = useState(false)
  if (!src)
    return (
      <span
        aria-label="Screenshot loading"
        className="size-40 animate-pulse rounded-md border border-main-view-fg/10 bg-main-view-fg/5"
      />
    )
  return (
    <button
      type="button"
      onClick={() => setBig((b) => !b)}
      title={big ? 'Smaller' : 'Bigger'}
      className={cn('block', big && 'w-full')}
    >
      <img
        src={src}
        alt="Attached screenshot"
        className={cn(
          'rounded-md border border-main-view-fg/10',
          big ? 'w-full object-contain' : 'size-40 object-cover'
        )}
      />
    </button>
  )
}
