import { createFileRoute } from '@tanstack/react-router'
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import {
  IconArrowDown,
  IconGripVertical,
  IconLayoutSidebarRightCollapse,
  IconMaximize,
  IconMessageCircle,
  IconScreenShare,
  IconVideo,
} from '@tabler/icons-react'
import { route } from '@/constants/routes'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
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
  type MirrorState,
} from '@/lib/remoteMirror'
import { cn } from '@/lib/utils'

// The remote mirror's viewer: open /mirror on another signed-in computer to
// follow the conversation open in Hi-chat, live (see lib/remoteMirror.ts).
// Its camera panel sends this computer's camera and mic to Meet on the
// computer running Hi-chat (see lib/remoteCamera.ts), and while that computer
// presents in Meet, its shared screen fills the space left of the text.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.mirror as any)({
  component: MirrorViewer,
})

// Reasoning stays out of the mirror, as it's folded away in Hi-chat
const withoutThinking = (text: string) =>
  text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim()

function useMirror() {
  const [state, setState] = useState<MirrorState>(emptyMirror)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let ws: WebSocket | null = null
    let stopped = false
    let retryMs = 1000
    let retry: ReturnType<typeof setTimeout> | undefined
    const connect = () => {
      const socket = new WebSocket(mirrorSocketUrl(window.location, 'view'))
      ws = socket
      socket.onopen = () => {
        retryMs = 1000
        setConnected(true)
      }
      socket.onmessage = (e) => {
        try {
          const m = JSON.parse(String(e.data))
          setState((s) => applyMirrorMessage(s, m))
        } catch {
          // not a mirror message
        }
      }
      socket.onclose = () => {
        if (ws !== socket) return
        setConnected(false)
        if (stopped) return
        retry = setTimeout(connect, retryMs)
        retryMs = Math.min(retryMs * 2, 15_000)
      }
    }
    connect()
    const ping = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send('{"t":"ping"}')
    }, 30_000)
    return () => {
      stopped = true
      clearInterval(ping)
      clearTimeout(retry)
      ws?.close()
    }
  }, [])

  return { state, connected }
}

function MirrorViewer() {
  const { state, connected } = useMirror()
  const cam = useCameraSender()
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
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const at = state.scroll
    if (following.current && at && 'id' in at) {
      const m = el.querySelector<HTMLElement>(
        `[data-mid="${CSS.escape(at.id)}"]`
      )
      if (m) {
        const top =
          m.getBoundingClientRect().top -
          el.getBoundingClientRect().top +
          el.scrollTop
        el.scrollTop = top + at.f * m.offsetHeight - 16
        placed.current = el.scrollTop
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
  }, [state.msgs, state.stream, state.scroll])

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
  const mirror = !connected
    ? { label: 'Reconnecting…', tone: 'waiting' as const }
    : !state.senderOn
      ? { label: "Hi-chat isn't open", tone: 'off' as const }
      : { label: 'Live', tone: 'live' as const }
  const camera = cameraState(cam)
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
              style={text}
              className="mx-auto flex max-w-md flex-col gap-6 text-base lg:mx-0 lg:max-w-none"
            >
              {empty && <EmptyState tone={mirror.tone} />}
              {state.msgs.map((m) => (
                <MirrorMessage
                  key={m.id}
                  id={m.id}
                  role={m.role}
                  text={m.text}
                />
              ))}
              {streaming && (
                <MirrorMessage
                  role="assistant"
                  text={streaming.text}
                  streaming
                />
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

function SharedScreen({
  stream,
  width,
}: {
  stream: MediaStream
  width?: number
}) {
  const pane = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [picture, setPicture] = useState(false)
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
        className="size-full object-contain"
      />
      {!picture && (
        <span className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
          Waiting for the picture…
        </span>
      )}
      <StatusPill
        tone="live"
        label="Presenting from Meet"
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
const MirrorMessage = memo(function MirrorMessage({
  id,
  role,
  text,
  streaming,
}: {
  id?: string
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
}) {
  const shown = withoutThinking(text)
  if (role === 'user')
    return (
      <div
        data-mid={id}
        className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-main-view-fg/[0.06] px-4 py-2.5 leading-relaxed"
      >
        {shown}
      </div>
    )
  return (
    <div data-mid={id} className="w-full">
      {streaming && !shown ? (
        <span
          className="inline-flex items-center gap-1 py-2"
          aria-label="Hi-chat is answering"
        >
          {[0, 150, 300].map((d) => (
            <span
              key={d}
              className="size-1.5 animate-bounce rounded-full bg-main-view-fg/40 motion-reduce:animate-none"
              style={{ animationDelay: `${d}ms` }}
            />
          ))}
        </span>
      ) : (
        <RenderMarkdown content={shown} isStreaming={streaming} />
      )}
    </div>
  )
})
