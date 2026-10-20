import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { route } from '@/constants/routes'
import {
  EXTENSION_FILES,
  extensionConfig,
  startCameraSender,
  zipFiles,
  type CameraStatus,
} from '@/lib/remoteCamera'
import { cn } from '@/lib/utils'

// The remote camera page. On the remote laptop it sends the camera and mic;
// on the computer that joins Meet it hands out the Chrome extension.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.camera as any)({
  component: CameraPage,
})

const AUTOSTART = 'hichat-camera-autostart'
const CHOICE = 'hichat-camera-devices'

const stored = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const store = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {
    // private window
  }
}

async function fetchKey(): Promise<string> {
  const res = await fetch('/api/camera-key', { method: 'POST' })
  if (!res.ok) throw new Error(`Couldn't get the camera key (${res.status})`)
  return (await res.json()).key
}

function CameraPage() {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const saved = JSON.parse(stored(CHOICE) ?? '{}')
  const [camId, setCamId] = useState<string>(saved.cam ?? '')
  const [micId, setMicId] = useState<string>(saved.mic ?? '')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [status, setStatus] = useState<CameraStatus | null>(null)
  const [autostart, setAutostart] = useState(stored(AUTOSTART) === '1')
  const preview = useRef<HTMLVideoElement>(null)
  const sender = useRef<ReturnType<typeof startCameraSender> | null>(null)

  useEffect(() => {
    fetchKey().then(setKey, (e) => setError(String(e.message ?? e)))
  }, [])

  const open = useCallback(async () => {
    const media = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: camId ? { exact: camId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      audio: { deviceId: micId ? { exact: micId } : undefined },
    })
    setDevices(await navigator.mediaDevices.enumerateDevices())
    return media
  }, [camId, micId])

  const start = useCallback(async () => {
    if (!key) return
    setError('')
    try {
      const media = await open()
      setStream(media)
      sender.current?.stop()
      sender.current = startCameraSender({
        stream: media,
        key,
        onStatus: setStatus,
      })
      store(AUTOSTART, '1')
      setAutostart(true)
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Allow the camera and microphone for this site, then press Start.'
          : String(e instanceof Error ? e.message : e)
      )
    }
  }, [key, open])

  const stop = useCallback(() => {
    sender.current?.stop()
    sender.current = null
    stream?.getTracks().forEach((t) => t.stop())
    setStream(null)
    setStatus(null)
  }, [stream])

  // Start by itself when this computer has sent before and may still use the camera
  useEffect(() => {
    if (!key || !autostart || sender.current) return
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') start()
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // A different camera or mic: swap it in without dropping Meet
  useEffect(() => {
    store(CHOICE, JSON.stringify({ cam: camId, mic: micId }))
    if (!sender.current || !stream) return
    let cancelled = false
    open().then(
      (media) => {
        if (cancelled) return media.getTracks().forEach((t) => t.stop())
        sender.current?.replace(media)
        stream.getTracks().forEach((t) => t.stop())
        setStream(media)
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camId, micId])

  useEffect(() => {
    if (preview.current) preview.current.srcObject = stream
  }, [stream])

  // Keep the screen (and the camera) awake while sending
  useEffect(() => {
    if (!stream) return
    let lock: WakeLockSentinel | undefined
    const take = () =>
      navigator.wakeLock
        ?.request('screen')
        .then((l) => (lock = l))
        .catch(() => {})
    take()
    const again = () => document.visibilityState === 'visible' && take()
    document.addEventListener('visibilitychange', again)
    return () => {
      document.removeEventListener('visibilitychange', again)
      lock?.release().catch(() => {})
    }
  }, [stream])

  useEffect(() => () => sender.current?.stop(), [])

  const download = async () => {
    const files: Record<string, string> = {}
    for (const name of EXTENSION_FILES)
      files[`hichat-camera/${name}`] =
        name === 'config.js'
          ? extensionConfig(window.location.origin, key)
          : await (await fetch(`/hichat-extension/${name}`)).text()
    const blob = new Blob([zipFiles(files)], { type: 'application/zip' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'hichat-camera.zip'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  const cams = devices.filter((d) => d.kind === 'videoinput')
  const mics = devices.filter((d) => d.kind === 'audioinput')
  const live = status?.connected
  const dot = !stream
    ? 'bg-main-view-fg/30'
    : !live
      ? 'bg-amber-500'
      : 'bg-green-500'
  const label = !stream
    ? 'Not sending'
    : !live
      ? 'Connecting…'
      : status?.viewers
        ? `Sending to ${status.viewers} Meet ${status.viewers === 1 ? 'tab' : 'tabs'}`
        : 'Ready, waiting for Meet'

  return (
    <div className="h-full overflow-y-auto px-4 py-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 text-base">
        <h1 className="text-xl font-medium">Hi-chat remote camera</h1>
        {error && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-red-600">
            {error}
          </p>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="font-medium">On the remote laptop</h2>
          <p className="text-main-view-fg/70">
            Keep this page open here to send this laptop's camera and microphone
            to Meet on your other computer.
          </p>
          <div className="relative overflow-hidden rounded-lg bg-black/80">
            <video
              ref={preview}
              autoPlay
              muted
              playsInline
              className="aspect-video w-full object-contain"
            />
            <span className="absolute left-2 top-2 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-sm text-white">
              <span className={cn('size-2 rounded-full', dot)} />
              {label}
            </span>
          </div>
          {stream && (
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                className="rounded-md border border-main-view-fg/10 bg-transparent px-2 py-1"
                value={camId}
                onChange={(e) => setCamId(e.target.value)}
                aria-label="Camera"
              >
                <option value="">Default camera</option>
                {cams.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Camera'}
                  </option>
                ))}
              </select>
              <select
                className="rounded-md border border-main-view-fg/10 bg-transparent px-2 py-1"
                value={micId}
                onChange={(e) => setMicId(e.target.value)}
                aria-label="Microphone"
              >
                <option value="">Default microphone</option>
                {mics.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Microphone'}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {stream ? (
              <button
                className="rounded-md border border-main-view-fg/20 px-4 py-2"
                onClick={stop}
              >
                Stop sending
              </button>
            ) : (
              <button
                className="rounded-md bg-primary px-4 py-2 text-primary-fg disabled:opacity-50"
                onClick={start}
                disabled={!key}
              >
                Start sending
              </button>
            )}
            <label className="flex items-center gap-2 text-sm text-main-view-fg/70">
              <input
                type="checkbox"
                checked={autostart}
                onChange={(e) => {
                  setAutostart(e.target.checked)
                  store(AUTOSTART, e.target.checked ? '1' : null)
                }}
              />
              Start by itself when this page opens
            </label>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="font-medium">On the computer that joins Meet</h2>
          <ol className="list-decimal space-y-1 pl-5 text-main-view-fg/80">
            <li>
              <button
                className="text-primary underline disabled:opacity-50"
                onClick={download}
                disabled={!key}
              >
                Download the Hi-chat camera extension
              </button>{' '}
              and unzip it.
            </li>
            <li>
              In Chrome, open <code>chrome://extensions</code> and turn on
              Developer mode.
            </li>
            <li>
              Click <b>Load unpacked</b> and choose the{' '}
              <code>hichat-camera</code> folder.
            </li>
            <li>
              In Meet, open Settings › Audio and Video and pick{' '}
              <b>Hi-chat remote camera</b> and <b>Hi-chat remote mic</b>.
            </li>
          </ol>
          <p className="text-sm text-main-view-fg/60">
            The extension holds a private key for your Hi-chat. Don't share the
            folder.
          </p>
        </section>
      </div>
    </div>
  )
}
