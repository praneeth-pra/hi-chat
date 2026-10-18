import { toast } from 'sonner'
import {
  cancelDictation as discardRecording,
  toggleDictation,
  useDictation,
} from '@/lib/dictation'

/**
 * Keys the Hi-chat Mac app sends to the page (as calls to
 * window.hiChatRemote) from its global shortcuts.
 */
/** Tap Left Control: start dictating, or stop and send. */
export const DICTATION_TOGGLE_KEY = 'F14'
/** fn + Right: send what's in the box. */
export const SEND_KEY = 'F15'
/** Escape while dictating: throw the recording away. */
export const DICTATION_CANCEL_KEY = 'Shift+F13'
/** fn + Up / Down: the code block above / below; again steps on. */
export const CODE_UP_KEY = 'Shift+F16'
export const CODE_DOWN_KEY = 'Shift+F17'
/** Tap Left Option: the cursor goes to the end of the message box. */
export const FOCUS_BOX_KEY = 'F17'

/** A press within this long of the last continues from where it was going. */
const CODE_STEP_MS = 1000
let codeStep: { at: number; target: HTMLElement } | null = null

/**
 * The area the chat scrolls in, as on screen. It is looked up by its marker:
 * a code block's own <pre> also counts as scrollable.
 */
function chatView(): { top: number; bottom: number } {
  const scroller = document.querySelector('[data-thread-scroller]')
  if (!scroller) return { top: 0, bottom: window.innerHeight }
  const { top, bottom } = scroller.getBoundingClientRect()
  return { top, bottom }
}

/**
 * Scrolls to the next code block above (-1) or below (1); returns true.
 * While the block it last went to is still on screen (or it is still
 * scrolling there), it steps on from that block, so presses near the end of
 * the chat, where a block can't reach the top, still move on. Otherwise it
 * starts from the block at the top of the chat.
 */
export function stepCode(dir: -1 | 1, now = Date.now()): boolean {
  const blocks = Array.from(
    document.querySelectorAll<HTMLElement>('[data-code-block]')
  )
  if (!blocks.length) {
    toast('No code in this chat')
    return true
  }
  const view = chatView()
  const last = codeStep ? blocks.indexOf(codeStep.target) : -1
  const onScreen = (b: HTMLElement) => {
    const r = b.getBoundingClientRect()
    return r.bottom > view.top && r.top < view.bottom
  }
  const follow =
    last >= 0 &&
    ((now >= codeStep!.at && now - codeStep!.at < CODE_STEP_MS) ||
      onScreen(blocks[last]))
  let target: HTMLElement | undefined
  if (follow) {
    target = blocks[last + dir]
  } else {
    // Where a block sits once scrolled to (scroll-mt-4 leaves 16 px above)
    const line = view.top + 16
    const top = (b: HTMLElement) => b.getBoundingClientRect().top
    target =
      dir < 0
        ? blocks.filter((b) => top(b) < line - 4).pop()
        : blocks.find((b) => top(b) > line + 4)
  }
  if (!target) {
    toast(dir < 0 ? 'No code above' : 'No code below')
    return true
  }
  codeStep = { at: now, target }
  target.scrollIntoView({ block: 'start', behavior: 'smooth' })
  return true
}

/** Puts the cursor at the end of the chat box. */
function focusChatBox(): boolean {
  const box = document.querySelector<HTMLTextAreaElement>(
    '[data-testid="chat-input"]'
  )
  if (!box) return false
  box.focus()
  box.setSelectionRange(box.value.length, box.value.length)
  return true
}

/** Dictation, send and code-block shortcuts. */
export function handleRemoteKey(key: string): boolean {
  if (key === FOCUS_BOX_KEY) return focusChatBox()
  if (key === CODE_UP_KEY) return stepCode(-1)
  if (key === CODE_DOWN_KEY) return stepCode(1)
  if (key === DICTATION_TOGGLE_KEY) {
    toggleDictation()
    return true
  }
  if (key === DICTATION_CANCEL_KEY || key === 'Escape') {
    const { status } = useDictation.getState()
    if (status !== 'recording' && status !== 'starting')
      return key === DICTATION_CANCEL_KEY
    discardRecording()
    toast('Dictation discarded')
    return true
  }
  if (key === SEND_KEY) {
    const send = document.querySelector<HTMLButtonElement>(
      '[data-test-id="send-message-button"]'
    )
    if (send && !send.disabled) send.click()
    else toast('Nothing to send')
    return true
  }
  return false
}

type MacAppWindow = Window & {
  hiChatRemote?: (key: string) => boolean
  webkit?: {
    messageHandlers?: { hiChat?: { postMessage: (message: unknown) => void } }
  }
}

/**
 * Inside the Hi-chat Mac app the keys come as calls instead of key presses,
 * and the app is told when dictation starts and stops (Escape then cancels
 * it). Returns the cleanup; does nothing in a browser.
 */
export function connectMacApp(win: MacAppWindow = window): () => void {
  const app = win.webkit?.messageHandlers?.hiChat
  if (!app) return () => {}
  win.hiChatRemote = handleRemoteKey
  const post = (status: string) => app.postMessage({ dictation: status })
  post(useDictation.getState().status)
  const stop = useDictation.subscribe((state, prev) => {
    if (state.status !== prev.status) post(state.status)
  })
  return () => {
    stop()
    delete win.hiChatRemote
  }
}

/**
 * Escape on the page throws a recording away; inside the Mac app the other
 * keys arrive as calls. Returns the cleanup.
 */
export function listenForRemoteKeys() {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.repeat && handleRemoteKey('Escape'))
      e.preventDefault()
  }
  window.addEventListener('keydown', onKey)
  const stopApp = connectMacApp()
  return () => {
    stopApp()
    window.removeEventListener('keydown', onKey)
  }
}
