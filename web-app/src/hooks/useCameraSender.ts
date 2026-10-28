import { useCallback, useEffect, useRef, useState } from 'react'
import {
  downloadCameraExtension,
  fetchCameraKey,
  startCameraSender,
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

const savedChoice = (): { cam?: string; mic?: string } => {
  try {
    return JSON.parse(stored(CHOICE) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

export type CameraSender = ReturnType<typeof useCameraSender>

export function useCameraSender({ link }: { link?: string } = {}) {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [camId, setCamId] = useState<string>(() => savedChoice().cam ?? '')
  const [micId, setMicId] = useState<string>(() => savedChoice().mic ?? '')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [status, setStatus] = useState<CameraStatus | null>(null)
  // Another page took the camera over, until this one starts again
  const [replaced, setReplaced] = useState(false)
  // The screen the computer in Meet is presenting, while it presents
  const [screen, setScreen] = useState<MediaStream | null>(null)
  // The Meet call's sound (the other participants), while connected
  const [call, setCall] = useState<MediaStream | null>(null)
  const [autostart, setAutostartState] = useState(
    () => stored(AUTOSTART) === '1'
  )
  const [starting, setStarting] = useState(false)
  const sender = useRef<ReturnType<typeof startCameraSender> | null>(null)

  useEffect(() => {
    // A mirror link has no login, so no key: the link itself lets it send
    if (link) return
    fetchCameraKey().then(setKey, (e) => setError(String(e.message ?? e)))
  }, [link])

  const open = useCallback(async () => {
    const media = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: camId ? { exact: camId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      // The call's sound plays on this computer now: keep it out of the mic
      audio: {
        deviceId: micId ? { exact: micId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })
    setDevices(await navigator.mediaDevices.enumerateDevices())
    return media
  }, [camId, micId])

  const start = useCallback(async () => {
    if (!key && !link) return
    setError('')
    setReplaced(false)
    setStarting(true)
    try {
      const media = await open()
      setStream(media)
      sender.current?.stop()
      sender.current = startCameraSender({
        stream: media,
        key,
        link,
        onStatus: (s) => {
          setStatus(s)
          if (s.replaced) setReplaced(true)
        },
        onScreen: setScreen,
        onCall: setCall,
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
  }, [key, link, open])

  // Someone is controlling the shared computer from /mirror: its picture
  // comes quicker meanwhile
  const setFastScreen = useCallback((on: boolean) => {
    sender.current?.setFastScreen(on)
  }, [])

  // A slow laptop here: the shared screen comes smaller
  const setLightScreen = useCallback((on: boolean) => {
    sender.current?.setLightScreen(on)
  }, [])

  // How the shared screen is arriving (for the readout on its panel)
  const screenStats = useCallback(
    () => sender.current?.screenStats() ?? Promise.resolve(null),
    []
  )

  const stop = useCallback(() => {
    sender.current?.stop()
    sender.current = null
    stream?.getTracks().forEach((t) => t.stop())
    setStream(null)
    setStatus(null)
    setScreen(null)
    setCall(null)
  }, [stream])

  // Taken over by another page: let the camera go here
  useEffect(() => {
    if (replaced && sender.current) stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaced])

  const setAutostart = useCallback((on: boolean) => {
    setAutostartState(on)
    store(AUTOSTART, on ? '1' : null)
  }, [])

  // Start by itself when this computer has sent before and may still use the camera
  useEffect(() => {
    if ((!key && !link) || !autostart || sender.current) return
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') start()
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, link])

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

  const downloadExtension = useCallback(
    () => downloadCameraExtension(key),
    [key]
  )

  return {
    key,
    link,
    /** Whether it can send: a key, or a link to send through */
    ready: !!(key || link),
    error,
    devices,
    camId,
    setCamId,
    micId,
    setMicId,
    stream,
    status,
    replaced,
    screen,
    setFastScreen,
    setLightScreen,
    screenStats,
    call,
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
