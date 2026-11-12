/**
 * Dictation from the computer's own sound: what the speakers or headphones
 * play (the other side of a call), taken straight from the Mac or Windows
 * app instead of picked up again by the microphone through the air. Cleaner,
 * with no echo, and only the call's voices, not yours.
 *
 * The apps that can do it say so in their user agent (HiChatComputerAudio),
 * so an older app keeps recording the mic. The page asks with { computerAudio: 'start' | 'stop' }; the app answers
 * 'started' (with the rate), 'failed' (with the error), and sends the sound
 * as { computerAudio: 'data', pcm }: mono 16-bit at that rate, base64, in
 * blocks of 40 ms, silence included.
 */

export type DictationSource = 'computer' | 'mic'
export const DICTATION_SOURCES: { value: DictationSource; label: string }[] = [
  { value: 'computer', label: 'Computer audio' },
  { value: 'mic', label: 'Microphone' },
]
const SOURCE_STORAGE_KEY = 'dictation-source'

/** Computer audio by default, where the app can record it. */
export function getDictationSource(): DictationSource {
  try {
    if (localStorage.getItem(SOURCE_STORAGE_KEY) === 'mic') return 'mic'
  } catch {
    // Storage blocked
  }
  return 'computer'
}

export function setDictationSource(source: DictationSource) {
  try {
    localStorage.setItem(SOURCE_STORAGE_KEY, source)
  } catch {
    // Storage blocked
  }
}

type Bridge = { postMessage: (message: unknown) => void }
type AppWindow = Window & {
  webkit?: { messageHandlers?: { hiChat?: Bridge } }
  chrome?: {
    webview?: Bridge & {
      addEventListener: (
        type: 'message',
        l: (e: { data: unknown }) => void
      ) => void
      removeEventListener: (
        type: 'message',
        l: (e: { data: unknown }) => void
      ) => void
    }
  }
  /** The Mac app calls this with each message (WKWebView has no 'message' event) */
  hiChatComputerAudio?: (message: unknown) => void
}

function bridge(): Bridge | undefined {
  if (typeof window === 'undefined') return undefined
  const win = window as AppWindow
  return win.webkit?.messageHandlers?.hiChat ?? win.chrome?.webview
}

/** This app can record the computer's sound. */
export function computerAudioAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /HiChatComputerAudio/.test(navigator.userAgent) &&
    !!bridge()
  )
}

/** Dictation records the computer's sound now (the setting, where it can). */
export function usesComputerAudio(): boolean {
  return getDictationSource() === 'computer' && computerAudioAvailable()
}

/** 16-bit samples, base64, as floats. Exported for tests. */
export function decodePcm(base64: string): Float32Array {
  const bytes = atob(base64)
  const out = new Float32Array(bytes.length >> 1)
  for (let i = 0; i < out.length; i++) {
    let s = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8)
    if (s >= 0x8000) s -= 0x10000
    out[i] = s / 32768
  }
  return out
}

export type ComputerAudio = {
  rate: number
  alive: () => boolean
  close: () => void
}

/** How long the app gets to start, and how long a gap in the sound means it stopped. */
const START_MS = 4000
const STALL_MS = 3000

// One capture in the app, shared by everything that listens (dictation, and
// the call's sound sent to /mirror): the app is asked to start for the first
// listener and to stop when the last one closes.
type Capture = {
  rate: number
  lastData: number
  failed: boolean
  listeners: Set<(block: Float32Array) => void>
  /** Settles when the app has started (or couldn't) */
  started: Promise<void>
  stop: () => void
}
let capture: Capture | null = null

function startCapture(app: Bridge): Capture {
  const win = window as AppWindow
  let done = false
  let settle: { resolve: () => void; reject: (e: Error) => void }
  const c: Capture = {
    rate: 0,
    lastData: Date.now(),
    failed: false,
    listeners: new Set(),
    started: new Promise<void>((resolve, reject) => {
      settle = { resolve, reject }
    }),
    stop: () => {
      if (done) return
      done = true
      clearTimeout(timer)
      win.chrome?.webview?.removeEventListener('message', onEvent)
      if (win.hiChatComputerAudio === onMessage)
        win.hiChatComputerAudio = undefined
      if (capture === c) capture = null
      app.postMessage({ computerAudio: 'stop' })
    },
  }
  // A listener that came and went before the start settles nothing
  c.started.catch(() => {})
  const onMessage = (data: unknown) => {
    if (done || !data || typeof data !== 'object') return
    const m = data as {
      computerAudio?: string
      rate?: number
      pcm?: string
      error?: string
    }
    if (m.computerAudio === 'data' && m.pcm && c.rate) {
      c.lastData = Date.now()
      const block = decodePcm(m.pcm)
      for (const l of [...c.listeners]) l(block)
    } else if (m.computerAudio === 'started' && !c.rate) {
      c.rate = m.rate || 48000
      c.lastData = Date.now()
      clearTimeout(timer)
      settle.resolve()
    } else if (m.computerAudio === 'failed') {
      c.failed = true
      if (!c.rate) {
        c.stop()
        settle.reject(new Error(m.error || 'Computer audio failed'))
      }
    }
  }
  const onEvent = (e: { data: unknown }) => onMessage(e.data)
  const timer = setTimeout(() => {
    c.stop()
    settle.reject(new Error('The app did not start computer audio'))
  }, START_MS)
  win.chrome?.webview?.addEventListener('message', onEvent)
  if (win.webkit?.messageHandlers?.hiChat) win.hiChatComputerAudio = onMessage
  app.postMessage({ computerAudio: 'start' })
  return c
}

/** Starts the app's computer-audio capture; each 40 ms block goes to onBlock. */
export async function openComputerAudio(
  onBlock: (block: Float32Array) => void
): Promise<ComputerAudio> {
  const app = bridge()
  if (!app) throw new Error('Computer audio needs the Hi-chat app')
  // A capture that stalled or failed is started afresh
  if (
    capture &&
    (capture.failed ||
      (capture.rate && Date.now() - capture.lastData >= STALL_MS))
  )
    capture.stop()
  const c = (capture ??= startCapture(app))
  c.listeners.add(onBlock)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    c.listeners.delete(onBlock)
    if (!c.listeners.size) c.stop()
  }
  try {
    await c.started
  } catch (e) {
    close()
    throw e
  }
  return {
    get rate() {
      return c.rate
    },
    alive: () =>
      !closed &&
      !c.failed &&
      capture === c &&
      Date.now() - c.lastData < STALL_MS,
    close,
  }
}
