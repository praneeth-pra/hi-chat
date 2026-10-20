import { createFileRoute } from '@tanstack/react-router'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconArrowDown,
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
// presents in Meet, its shared screen fills the left half of the page.

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
  const atBottom = useRef(true)
  const [showJump, setShowJump] = useState(false)

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
      el.scrollTop = el.scrollHeight
      placed.current = el.scrollTop
      atBottom.current = true
      setShowJump(false)
    } else setShowJump(true)
  }, [state.msgs, state.stream, state.scroll])

  const jumpToLatest = () => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
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

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative flex min-h-0 flex-1 flex-col lg:basis-0">
          {/* On a phone the header has no room for the mirror's status */}
          <div className="flex justify-center border-b border-main-view-fg/5 py-1.5 sm:hidden">
            <StatusPill tone={mirror.tone} label={mirror.label} />
          </div>
          <div
            ref={scroller}
            className="flex-1 overflow-y-auto px-4 py-6"
            onScroll={(e) => {
              const el = e.currentTarget
              if (Math.abs(el.scrollTop - placed.current) > 2)
                following.current = false
              atBottom.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 40
              if (atBottom.current) setShowJump(false)
            }}
          >
            {/* A comfortable reading width; beside a shared screen the half
                is narrower than this anyway */}
            <div className="mx-auto flex max-w-2xl flex-col gap-6 text-base">
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

        {/* While the computer in Meet presents, its screen takes the left half */}
        {cam.screen && <SharedScreen stream={cam.screen} />}

        {panelOpen && (
          <aside
            id="mirror-camera-panel"
            aria-label="Remote camera"
            className="order-first max-h-[55vh] shrink-0 overflow-y-auto border-b border-main-view-fg/10 bg-main-view-fg/[0.015] p-4 lg:order-last lg:max-h-none lg:w-[360px] lg:border-b-0 lg:border-l lg:p-5"
          >
            <RemoteCameraPanel cam={cam} />
          </aside>
        )}
      </div>
    </div>
  )
}

function SharedScreen({ stream }: { stream: MediaStream }) {
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
      aria-label="Shared screen"
      className="group relative order-first flex aspect-video shrink-0 items-center justify-center border-b border-main-view-fg/10 bg-neutral-950 lg:aspect-auto lg:min-h-0 lg:flex-1 lg:basis-0 lg:border-b-0 lg:border-r"
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
