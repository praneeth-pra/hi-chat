import { useEffect, useRef } from 'react'
import {
  IconCamera,
  IconChevronDown,
  IconDownload,
  IconLoader2,
  IconMicrophone,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconVideoOff,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cameraState, type CameraSender } from '@/hooks/useCameraSender'
import { cn } from '@/lib/utils'

// The remote camera's controls, shown beside the mirror: a preview, the
// camera and mic in use, Start/Stop, and how to set up Meet on the other
// computer. The sending itself lives in useCameraSender, outside this panel.

export const toneDot = {
  off: 'bg-main-view-fg/30',
  waiting: 'bg-amber-500',
  live: 'bg-green-500',
} as const

export function StatusPill({
  tone,
  label,
  icon,
  className,
}: {
  tone: keyof typeof toneDot
  label: string
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-main-view-fg/10 bg-main-view px-2.5 py-1 text-xs text-main-view-fg/70',
        className
      )}
    >
      <span className="relative flex size-2">
        {tone === 'live' && (
          <span
            className={cn(
              'absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden',
              toneDot[tone]
            )}
          />
        )}
        <span
          className={cn(
            'relative inline-flex size-2 rounded-full',
            toneDot[tone]
          )}
        />
      </span>
      {icon}
      <span className="truncate">{label}</span>
    </span>
  )
}

function DeviceSelect({
  icon,
  label,
  value,
  onChange,
  devices,
  fallback,
}: {
  icon: React.ReactNode
  label: string
  value: string
  onChange: (v: string) => void
  devices: MediaDeviceInfo[]
  fallback: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-main-view-fg/60">
        {icon}
        {label}
      </span>
      <select
        className="h-9 w-full truncate rounded-md border border-main-view-fg/10 bg-main-view px-2 text-sm text-main-view-fg outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Default {fallback}</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || fallback}
          </option>
        ))}
      </select>
    </label>
  )
}

export function RemoteCameraPanel({ cam }: { cam: CameraSender }) {
  const preview = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (preview.current) preview.current.srcObject = cam.stream
  }, [cam.stream])

  const state = cameraState(cam)
  const cams = cam.devices.filter((d) => d.kind === 'videoinput')
  const mics = cam.devices.filter((d) => d.kind === 'audioinput')

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-main-view-fg">
          Remote camera
        </h2>
        <p className="text-sm leading-relaxed text-main-view-fg/60">
          Send this laptop's camera and microphone to Meet, Teams or Zoom (in
          the browser) on your other computer.
        </p>
      </div>

      {cam.replaced && !cam.stream && (
        <p
          role="status"
          className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          Another page took over the camera. Press Start sending to take it
          back.
        </p>
      )}
      {cam.error && (
        <p
          role="alert"
          className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600"
        >
          {cam.error}
        </p>
      )}

      <div className="relative overflow-hidden rounded-xl border border-main-view-fg/10 bg-neutral-950 shadow-sm">
        <video
          ref={preview}
          autoPlay
          muted
          playsInline
          className={cn(
            'aspect-video w-full object-cover',
            !cam.stream && 'invisible'
          )}
        />
        {!cam.stream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/50">
            <IconVideoOff size={28} stroke={1.5} />
            <span className="text-xs">Camera is off</span>
          </div>
        )}
        <StatusPill
          tone={state.tone}
          label={state.label}
          className="absolute left-2 top-2 border-white/10 bg-black/60 text-white/90 backdrop-blur"
        />
      </div>

      {cam.stream ? (
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          onClick={cam.stop}
        >
          <IconPlayerStopFilled />
          Stop sending
        </Button>
      ) : (
        <Button
          size="lg"
          className="w-full"
          onClick={cam.start}
          disabled={!cam.ready || cam.starting}
        >
          {cam.starting ? (
            <IconLoader2 className="animate-spin" />
          ) : (
            <IconPlayerPlayFilled />
          )}
          Start sending
        </Button>
      )}

      {cam.stream && (
        <div className="grid gap-3">
          <DeviceSelect
            icon={<IconCamera size={14} />}
            label="Camera"
            value={cam.camId}
            onChange={cam.setCamId}
            devices={cams}
            fallback="camera"
          />
          <DeviceSelect
            icon={<IconMicrophone size={14} />}
            label="Microphone"
            value={cam.micId}
            onChange={cam.setMicId}
            devices={mics}
            fallback="microphone"
          />
        </div>
      )}

      <label className="flex items-center justify-between gap-3 text-sm text-main-view-fg/80">
        Start by itself when this page opens
        <Switch checked={cam.autostart} onCheckedChange={cam.setAutostart} />
      </label>

      <details className="group rounded-lg border border-main-view-fg/10 bg-main-view-fg/[0.02]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-main-view-fg/80 [&::-webkit-details-marker]:hidden">
          Set up the call on the other computer
          <IconChevronDown
            size={16}
            className="text-main-view-fg/50 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="flex flex-col gap-3 border-t border-main-view-fg/10 px-3 py-3 text-sm text-main-view-fg/70">
          {cam.link ? (
            // The extension holds the camera key, which needs a login
            <p className="rounded-md bg-main-view-fg/[0.04] px-3 py-2 text-xs">
              The extension's download needs a login: get it from the signed-in{' '}
              <code>/mirror</code> page.
            </p>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              onClick={cam.downloadExtension}
              disabled={!cam.key}
            >
              <IconDownload />
              Download the camera extension
            </Button>
          )}
          <ol className="list-decimal space-y-1.5 pl-5 leading-relaxed">
            <li>Unzip it.</li>
            <li>
              In Chrome (or Brave, Edge), open <code>chrome://extensions</code>{' '}
              and turn on Developer mode.
            </li>
            <li>
              Click <b>Load unpacked</b> and choose the{' '}
              <code>hichat-camera</code> folder.
            </li>
            <li>
              Join the call in the browser (Meet, Teams, or Zoom's web client).
              In its audio and video settings pick <b>Hi-chat remote camera</b>{' '}
              and <b>Hi-chat remote mic</b>.
            </li>
          </ol>
          <p className="text-xs text-main-view-fg/50">
            The extension holds a private key for your Hi-chat. Don't share the
            folder.
          </p>
        </div>
      </details>
    </div>
  )
}
