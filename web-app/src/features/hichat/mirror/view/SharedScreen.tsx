import { useEffect, useMemo, useRef, useState } from 'react'
import { IconMaximize, IconPencil, IconScreenShare } from '@tabler/icons-react'
import type { RemoteInput } from '@/features/hichat/mirror/lib/mirrorDirect'
import {
  createSlowWatch,
  type ScreenStats,
} from '@/features/hichat/camera/remoteCamera'
import { StatusPill } from '@/features/hichat/camera/RemoteCameraPanel'
import { cn } from '@/lib/utils'
import { ScreenStatsBadge } from './ConnectionQuality'
import { useRemoteControl } from './useRemoteControl'

/** While the computer in Meet presents: its screen, which can be edited from here. */
export function SharedScreen({
  stream,
  width,
  canEdit,
  sendInput,
  onEditing,
  readStats,
  onSlow,
}: {
  stream: MediaStream
  width?: number
  /** How the picture is arriving, for the readout in its corner */
  readStats: () => Promise<ScreenStats | null>
  /** This laptop can't decode the full picture in time */
  onSlow: () => void
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
  // Lightened for this laptop (it stays so while the page is open)
  const [light, setLight] = useState(false)
  const lightRef = useRef(false)
  const slow = useMemo(createSlowWatch, [])
  const onSlowRef = useRef(onSlow)
  onSlowRef.current = onSlow
  useEffect(() => {
    if (!picture) return
    let live = true
    const read = () =>
      readStats()
        .then((s) => {
          if (!live) return
          setStats(s)
          // Too slow to decode it all: from now on it comes smaller
          if (!lightRef.current && slow(s)) {
            lightRef.current = true
            setLight(true)
            onSlowRef.current()
          }
        })
        .catch(() => {})
    read()
    const timer = setInterval(read, 2000)
    return () => {
      live = false
      clearInterval(timer)
      setStats(null)
    }
  }, [picture, readStats, slow])
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
      <ScreenStatsBadge stats={stats} light={light} />
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
