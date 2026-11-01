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

/** Starts the app's computer-audio capture; each 40 ms block goes to onBlock. */
export function openComputerAudio(
  onBlock: (block: Float32Array) => void
): Promise<ComputerAudio> {
  const app = bridge()
  if (!app)
    return Promise.reject(new Error('Computer audio needs the Hi-chat app'))
  const win = window as AppWindow
  return new Promise((resolve, reject) => {
    let rate = 0
    let lastData = Date.now()
    let failed = false
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      win.chrome?.webview?.removeEventListener('message', onEvent)
      if (win.hiChatComputerAudio === onMessage)
        win.hiChatComputerAudio = undefined
      app.postMessage({ computerAudio: 'stop' })
    }
    const handle: ComputerAudio = {
      get rate() {
        return rate
      },
      alive: () => !closed && !failed && Date.now() - lastData < STALL_MS,
      close,
    }
    const onMessage = (data: unknown) => {
      if (closed || !data || typeof data !== 'object') return
      const m = data as {
        computerAudio?: string
        rate?: number
        pcm?: string
        error?: string
      }
      if (m.computerAudio === 'data' && m.pcm && rate) {
        lastData = Date.now()
        onBlock(decodePcm(m.pcm))
      } else if (m.computerAudio === 'started' && !rate) {
        rate = m.rate || 48000
        lastData = Date.now()
        clearTimeout(timer)
        resolve(handle)
      } else if (m.computerAudio === 'failed') {
        failed = true
        if (!rate) {
          close()
          reject(new Error(m.error || 'Computer audio failed'))
        }
      }
    }
    const onEvent = (e: { data: unknown }) => onMessage(e.data)
    const timer = setTimeout(() => {
      close()
      reject(new Error('The app did not start computer audio'))
    }, START_MS)
    win.chrome?.webview?.addEventListener('message', onEvent)
    if (win.webkit?.messageHandlers?.hiChat) win.hiChatComputerAudio = onMessage
    app.postMessage({ computerAudio: 'start' })
  })
}
