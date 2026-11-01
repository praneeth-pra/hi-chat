import {
  IconLayoutSidebarRightCollapse,
  IconVideo,
  IconVolume,
  IconVolumeOff,
} from '@tabler/icons-react'
import { StatusPill, toneDot } from '@/features/hichat/camera/RemoteCameraPanel'
import type { cameraState } from '@/features/hichat/camera/useCameraSender'
import { cn } from '@/lib/utils'
import { CallSound } from './CallSound'
import type { mirrorStatus } from './connectionStatus'

/**
 * The mirror page's header: the conversation's title, the mirror's status,
 * the Meet call's sound and the camera panel's button.
 */
export function MirrorHeader({
  title,
  mirror,
  call,
  callMuted,
  callBlocked,
  onToggleMute,
  onUnblockCall,
  onCallBlocked,
  panelOpen,
  onTogglePanel,
  camera,
}: {
  title: string
  mirror: ReturnType<typeof mirrorStatus>
  /** The Meet call's sound, while there is a call */
  call: MediaStream | null | undefined
  callMuted: boolean
  /** The browser wants a click before it plays the call */
  callBlocked: boolean
  onToggleMute: () => void
  onUnblockCall: () => void
  onCallBlocked: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  camera: ReturnType<typeof cameraState>
}) {
  return (
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
          {title || 'Conversation'}
        </h1>
      </div>
      <StatusPill
        tone={mirror.tone}
        label={mirror.label}
        className="hidden sm:inline-flex"
      />
      {call &&
        (callBlocked ? (
          <button
            type="button"
            onClick={onUnblockCall}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-medium text-accent-fg"
          >
            <IconVolume size={16} />
            Click to hear the call
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleMute}
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
            {callMuted ? <IconVolumeOff size={16} /> : <IconVolume size={16} />}
            <span className="hidden sm:inline">Call</span>
          </button>
        ))}
      {call && (
        <CallSound
          stream={call}
          muted={callMuted}
          blocked={callBlocked}
          onBlocked={onCallBlocked}
        />
      )}
      <button
        type="button"
        onClick={onTogglePanel}
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
  )
}
