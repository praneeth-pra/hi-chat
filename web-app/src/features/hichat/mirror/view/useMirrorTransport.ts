import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MIRROR_CLOSE_LINK_ENDED,
  MIRROR_CLOSE_VERSION_UNSUPPORTED,
  type MirrorFromViewer,
} from '@janhq/core'
import {
  createDirectViewer,
  createSeqFilter,
  type RemoteInput,
} from '@/features/hichat/mirror/lib/mirrorDirect'
import {
  applyMirrorMessage,
  emptyMirror,
  mirrorSocketUrl,
  type MirrorState,
} from '@/features/hichat/mirror/lib/remoteMirror'

// The mirror viewer's transport: the socket to Hi-chat's server (with its
// reconnects and pings), the direct WebRTC channel to Hi-chat
// (lib/mirrorDirect.ts), each update applied once whichever route brings it
// first, and the link's code door.

/** The server's close code for a link that has ended (core's mirror types). */
const LINK_ENDED = MIRROR_CLOSE_LINK_ENDED

/** A link's door: shut until the code Hi-chat shows is typed. */
export type Gate = {
  shut: boolean
  /** A code was asked for */
  asked?: boolean
  /** After a wrong (or run-out) code: tries left; 0 asks for a new code */
  left?: number
  /** Too many wrong codes: only a reload brings a new one */
  spent?: boolean
  /** Too many wrong codes on this link, from anyone: only a new link opens */
  locked?: boolean
}

export function useMirrorTransport(link?: string) {
  const [state, setState] = useState<MirrorState>(emptyMirror)
  const [connected, setConnected] = useState(false)
  // A link that has ended (revoked in Hi-chat, 90 minutes old, or its app
  // gone 12 h)
  const [ended, setEnded] = useState(false)
  // Round trip to Hi-chat's server, in ms, from the pings below
  const [lag, setLag] = useState<number | null>(null)
  // With a direct channel to Hi-chat open: the round trip over it
  const [directLag, setDirectLag] = useState<number | null>(null)
  const [direct, setDirect] = useState(false)
  // Whether the Hi-chat app at the other end can be controlled from here
  const [controllable, setControllable] = useState(false)
  const sendInputRef = useRef<(m: RemoteInput) => boolean>(() => false)
  const sendInput = useCallback((m: RemoteInput) => sendInputRef.current(m), [])
  // On a link: shut until the code Hi-chat shows is typed, and how the
  // last code went. Let in, the ticket lets this page back in after a
  // dropped connection (and lets its camera send)
  const [gate, setGate] = useState<Gate>({ shut: !!link })
  const [ticket, setTicket] = useState<string | undefined>()
  const toServer = useRef<(m: MirrorFromViewer) => boolean>(() => false)
  const askForCode = useCallback(() => {
    if (!toServer.current({ t: 'unlock' })) return false
    // The box starts fresh; Hi-chat says again if no code is left
    setGate((g) => ({ shut: g.shut, asked: true }))
    return true
  }, [])
  const sendCode = useCallback(
    (code: string) => toServer.current({ t: 'code', code }),
    []
  )

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
    let pass: string | undefined
    toServer.current = (m) => {
      if (ws?.readyState !== WebSocket.OPEN) return false
      ws.send(JSON.stringify(m))
      return true
    }
    const ping = () => {
      const n = performance.now()
      peer.ping(n)
      // The server too: it keeps the socket open, and is the fallback
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ t: 'ping', n }))
    }
    const connect = () => {
      const socket = new WebSocket(
        mirrorSocketUrl(window.location, 'view', link) +
          (link && pass ? `&ticket=${encodeURIComponent(pass)}` : '')
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
        // A link's door: shut until the code, then in
        if (m.t === 'gate') return setGate((g) => ({ ...g, shut: true }))
        if (m.t === 'admitted') {
          const t = (m as { ticket?: unknown }).ticket
          if (typeof t === 'string') setTicket((pass = t))
          return setGate({ shut: false })
        }
        if (m.t === 'code') {
          const c = m as { left?: unknown; spent?: unknown; locked?: unknown }
          return setGate({
            shut: true,
            asked: true,
            left: typeof c.left === 'number' ? Math.max(0, c.left) : 0,
            ...(c.spent === true ? { spent: true } : {}),
            ...(c.locked === true ? { locked: true } : {}),
          })
        }
        for (const x of seq.take(m, 'relay')) queue(x)
      }
      socket.onclose = (e) => {
        if (ws !== socket) return
        setConnected(false)
        setLag(null)
        // Hi-chat offers again once the server introduces us again
        peer.closeAll()
        if (stopped) return
        // The link has ended: clear the old conversation and stop trying
        if (e.code === LINK_ENDED) {
          stopped = true
          pending = []
          setState(emptyMirror)
          setEnded(true)
          return
        }
        // A server older than this page: try now and then, it may be updated
        if (e.code === MIRROR_CLOSE_VERSION_UNSUPPORTED) retryMs = 15_000
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

  return {
    state,
    connected,
    ended,
    lag: direct ? (directLag ?? lag) : lag,
    direct,
    controllable,
    sendInput,
    gate,
    ticket,
    askForCode,
    sendCode,
  }
}

/** Keep the screen (and so the mirror) awake while this page is open. */
export function useScreenWakeLock() {
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
}
