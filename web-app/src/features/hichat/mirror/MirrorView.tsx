import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { IconArrowDown } from '@tabler/icons-react'
import { AccuracyProgress } from '@/containers/AccuracyProgress'
import {
  RemoteCameraPanel,
  StatusPill,
} from '@/features/hichat/camera/RemoteCameraPanel'
import {
  AUTOSTART,
  CAMERA_PANEL,
  cameraState,
  store,
  stored,
  useCameraSender,
} from '@/features/hichat/camera/useCameraSender'
import {
  useMirrorTransport,
  useScreenWakeLock,
} from './view/useMirrorTransport'
import {
  GAP,
  PANEL_WIDTH,
  MIN_TEXT,
  SPLIT,
  TEXT_WIDTH,
  clampScreen,
  useLook,
  useWide,
} from './view/layout'
import { mirrorStatus } from './view/connectionStatus'
import { CALL_MUTED } from './view/CallSound'
import { MirrorHeader } from './view/MirrorHeader'
import { useFollowScroll } from './view/useFollowScroll'
import { Divider } from './view/Divider'
import { LinkDoor } from './view/LinkDoor'
import { SharedScreen } from './view/SharedScreen'
import { EmptyState } from './view/EmptyState'
import { MirrorComposer } from './view/MirrorComposer'
import { MirrorMessage } from './view/MirrorMessage'
import { streamingMsg } from './view/streamingMsg'

export type { Gate } from './view/useMirrorTransport'

// The remote mirror's viewer: open an app's link (/m/<link>) on another
// computer and type the code Hi-chat shows, to follow the conversation open
// in that app, live (see lib/remoteMirror.ts).
// Its camera panel sends this computer's camera and mic to Meet on the
// computer running Hi-chat (see features/hichat/camera/remoteCamera.ts), and while that computer
// presents in Meet, its shared screen fills the space left of the text.
// The page is composed from view/: the transport
// (useMirrorTransport), the layout, the shared screen and its connection
// readout, the code door and the messages.

/**
 * The mirror page, through an app's own link at /m/<link> without login,
 * once let in with the code Hi-chat shows.
 */
export function MirrorViewer({ link }: { link?: string } = {}) {
  const {
    state,
    connected,
    ended,
    lag,
    direct,
    controllable,
    sendInput,
    gate,
    ticket,
    askForCode,
    sendCode,
  } = useMirrorTransport(link)
  useScreenWakeLock()
  const cam = useCameraSender({ link, ticket })
  useLook(state.look)
  // Hi-chat's own column width, so lines break where they break there
  const column = state.look?.width || TEXT_WIDTH
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

  const { scroller, end, content, showJump, jumpToLatest, onScroll } =
    useFollowScroll(state)

  const streaming =
    state.stream && !state.msgs.some((m) => m.id === state.stream?.id)
      ? state.stream
      : null
  const mirror = mirrorStatus({
    connected,
    senderOn: state.senderOn,
    lag,
    direct,
  })
  const camera = cameraState(cam)
  // The Meet call's sound: on unless muted here (remembered)
  const [callMuted, setCallMuted] = useState(() => stored(CALL_MUTED) === '1')
  const [callBlocked, setCallBlocked] = useState(false)
  const blockCall = useCallback(() => setCallBlocked(true), [])
  const empty = state.msgs.length === 0 && !streaming

  // On a laptop the shared screen sits left of the text, sized by a divider
  // you can drag; the text stays centred unless the screen would cover it
  // A link opens on the code door, so the body only appears once let in:
  // watch it from when it appears, not from the first render (watching from
  // the first render left its width at 0, which hid the divider and put the
  // text under the shared screen)
  const body = useRef<HTMLDivElement | null>(null)
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null)
  const bodyRef = useCallback((el: HTMLDivElement | null) => {
    body.current = el
    setBodyEl(el)
  }, [])
  const wide = useWide()
  const [bodyWidth, setBodyWidth] = useState(0)
  useLayoutEffect(() => {
    const el = bodyEl
    if (!el) return
    const watch = new ResizeObserver(() => setBodyWidth(el.clientWidth))
    watch.observe(el)
    setBodyWidth(el.clientWidth)
    return () => watch.disconnect()
  }, [bodyEl])
  const [split, setSplit] = useState<number | null>(() => {
    const saved = Number(stored(SPLIT))
    return saved > 0 && saved < 1 ? saved : null
  })
  const right = panelOpen ? PANEL_WIDTH : 0
  const screenWidth = cam.screen
    ? clampScreen(
        split === null ? (bodyWidth - column) / 2 - GAP : split * bodyWidth,
        bodyWidth,
        right
      )
    : 0
  const textLeft = Math.max(
    screenWidth ? screenWidth + GAP : 0,
    (bodyWidth - column) / 2
  )
  const text =
    wide && bodyWidth
      ? {
          width: Math.max(
            MIN_TEXT,
            Math.min(column, bodyWidth - right - GAP - textLeft)
          ),
          marginLeft: textLeft,
        }
      : { maxWidth: column }

  if (ended)
    return (
      <div
        data-testid="mirror-link-ended"
        className="flex h-full flex-col items-center justify-center gap-2 bg-main-view px-6 text-center text-main-view-fg"
      >
        <h1 className="text-base font-semibold">This mirror link has ended</h1>
        <p className="max-w-sm text-sm text-main-view-fg/60">
          Links last 90 minutes, and Hi-chat can revoke one sooner. Copy a new
          link from Hi-chat to keep watching.
        </p>
      </div>
    )
  if (link && gate.shut)
    return (
      <LinkDoor
        gate={gate}
        hiChatOn={state.senderOn}
        askForCode={askForCode}
        sendCode={sendCode}
      />
    )
  return (
    <div className="flex h-full flex-col bg-main-view text-main-view-fg">
      <MirrorHeader
        title={state.title}
        mirror={mirror}
        call={cam.call}
        callMuted={callMuted}
        callBlocked={callBlocked}
        onToggleMute={() =>
          setCallMuted((m) => {
            store(CALL_MUTED, m ? null : '1')
            return !m
          })
        }
        onUnblockCall={() => setCallBlocked(false)}
        onCallBlocked={blockCall}
        panelOpen={panelOpen}
        onTogglePanel={togglePanel}
        camera={camera}
      />

      {/* On a laptop: the shared screen on the left (with its divider), the
          text centred, the camera panel on the right. The conversation scrolls
          across the whole width beneath them; on a phone they stack */}
      <div ref={bodyRef} className="relative flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* On a phone the header has no room for the mirror's status */}
          <div className="flex justify-center border-b border-main-view-fg/5 py-1.5 sm:hidden">
            <StatusPill tone={mirror.tone} label={mirror.label} />
          </div>
          <div
            ref={scroller}
            className="flex-1 overflow-y-auto px-4 pt-4 pb-3 lg:px-0"
            onScroll={onScroll}
          >
            {/* A comfortable reading width; beside a shared screen the half
                is narrower than this anyway */}
            <div
              ref={content}
              style={text}
              className="mx-auto flex w-full flex-col lg:mx-0"
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
                    shown={state.shown?.id === m.id ? state.shown.n : undefined}
                    last={!streaming && m === state.msgs[state.msgs.length - 1]}
                  />
                )),
                streaming && (
                  <MirrorMessage
                    key={streaming.id}
                    msg={streamingMsg(streaming)}
                    streaming
                    last
                    shown={
                      state.shown?.id === streaming.id
                        ? state.shown.n
                        : undefined
                    }
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
          <MirrorComposer text={state.typing} busy={!!streaming} style={text} />
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
            onSlow={() => cam.setLightScreen(true)}
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
