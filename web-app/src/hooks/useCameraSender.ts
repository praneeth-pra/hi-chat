import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EXTENSION_FILES,
  extensionConfig,
  startCameraSender,
  zipFiles,
  type CameraStatus,
} from '@/lib/remoteCamera'

// The remote camera's sending side as a hook, so /mirror can send this
// laptop's camera and mic while it follows the conversation. The sender lives
// as long as the page, whether or not its panel is open.

export const AUTOSTART = 'hichat-camera-autostart'
/** Remembers whether /mirror's camera panel is open on this computer. */
export const CAMERA_PANEL = 'hichat-mirror-camera-panel'
const CHOICE = 'hichat-camera-devices'

export const stored = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
export const store = (k: string, v: string | null) => {
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

const savedChoice = (): { cam?: string; mic?: string } => {
  try {
    return JSON.parse(stored(CHOICE) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

export type CameraSender = ReturnType<typeof useCameraSender>

export function useCameraSender() {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [camId, setCamId] = useState<string>(() => savedChoice().cam ?? '')
  const [micId, setMicId] = useState<string>(() => savedChoice().mic ?? '')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [status, setStatus] = useState<CameraStatus | null>(null)
  // The screen the computer in Meet is presenting, while it presents
  const [screen, setScreen] = useState<MediaStream | null>(null)
  const [autostart, setAutostartState] = useState(
    () => stored(AUTOSTART) === '1'
  )
  const [starting, setStarting] = useState(false)
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
    setStarting(true)
    try {
      const media = await open()
      setStream(media)
      sender.current?.stop()
      sender.current = startCameraSender({
        stream: media,
        key,
        onStatus: setStatus,
        onScreen: setScreen,
      })
      store(AUTOSTART, '1')
      setAutostartState(true)
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Allow the camera and microphone for this site, then press Start.'
          : String(e instanceof Error ? e.message : e)
      )
    } finally {
      setStarting(false)
    }
  }, [key, open])

  const stop = useCallback(() => {
    sender.current?.stop()
    sender.current = null
    stream?.getTracks().forEach((t) => t.stop())
    setStream(null)
    setStatus(null)
    setScreen(null)
  }, [stream])

  const setAutostart = useCallback((on: boolean) => {
    setAutostartState(on)
    store(AUTOSTART, on ? '1' : null)
  }, [])

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

  const downloadExtension = useCallback(async () => {
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
  }, [key])

  return {
    key,
    error,
    devices,
    camId,
    setCamId,
    micId,
    setMicId,
    stream,
    status,
    screen,
    autostart,
    setAutostart,
    starting,
    start,
    stop,
    downloadExtension,
  }
}

/** The camera's state in a few words, with its tone. */
export function cameraState(cam: Pick<CameraSender, 'stream' | 'status'>): {
  label: string
  tone: 'off' | 'waiting' | 'live'
} {
  if (!cam.stream) return { label: 'Camera off', tone: 'off' }
  if (!cam.status?.connected) return { label: 'Connecting…', tone: 'waiting' }
  const n = cam.status.viewers
  if (!n) return { label: 'Ready, waiting for Meet', tone: 'waiting' }
  return {
    label: `Sending to ${n} Meet ${n === 1 ? 'tab' : 'tabs'}`,
    tone: 'live',
  }
}
