import { toast } from 'sonner'
import { create } from 'zustand'
import {
  cancelDictation as discardRecording,
  toggleDictation,
  useDictation,
} from '@/lib/dictation'
import { deliverScreenshot } from '@/lib/screenshotDelivery'

/**
 * Keys the Hi-chat Mac and Windows apps send to the page (as calls to
 * window.hiChatRemote) from their global shortcuts. The comments name the
 * Mac shortcuts; windows-app/HiChat.cs lists the Windows ones.
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
/** fn + N: a new chat. */
export const NEW_CHAT_KEY = 'Shift+F18'

/** Opens a new chat; set by the page, which has the router. */
let openNewChat: () => void = () => {}

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
  if (key === NEW_CHAT_KEY) {
    openNewChat()
    return true
  }
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

/**
 * Inside the app: whether typing into Hi-chat is on (tap Option on a Mac,
 * Right Alt on Windows), so the message box can show it.
 */
export const useAppTyping = create<{ inApp: boolean; typing: boolean }>(() => ({
  inApp: false,
  typing: false,
}))

type Bridge = { postMessage: (message: unknown) => void }
type AppWindow = Window & {
  hiChatRemote?: (key: string) => boolean
  hiChatTyping?: (on: boolean) => void
  /** The screenshot key: a JPEG or PNG data URL to send as it is */
  hiChatScreenshot?: (dataUrl: string) => boolean
  /** The Mac app (WKWebView) */
  webkit?: { messageHandlers?: { hiChat?: Bridge } }
  /** The Windows app (WebView2) */
  chrome?: { webview?: Bridge }
}

/**
 * Inside the Hi-chat Mac or Windows app the keys come as calls instead of
 * key presses, and the app is told when dictation starts and stops (Escape
 * then cancels it). Returns the cleanup; does nothing in a browser.
 */
export function connectApp(win: AppWindow = window): () => void {
  const app = win.webkit?.messageHandlers?.hiChat ?? win.chrome?.webview
  if (!app) return () => {}
  win.hiChatRemote = handleRemoteKey
  win.hiChatTyping = (on) => useAppTyping.setState({ typing: on })
  win.hiChatScreenshot = (dataUrl) => deliverScreenshot(dataUrl)
  useAppTyping.setState({ inApp: true })
  const post = (status: string) => app.postMessage({ dictation: status })
  post(useDictation.getState().status)
  const stop = useDictation.subscribe((state, prev) => {
    if (state.status !== prev.status) post(state.status)
  })
  return () => {
    stop()
    delete win.hiChatRemote
    delete win.hiChatTyping
    delete win.hiChatScreenshot
    useAppTyping.setState({ inApp: false, typing: false })
  }
}

/**
 * Inside the Mac or Windows app: asks it to look for a new version (it
 * answers in its own dialog, even "up to date"). False in a browser.
 */
export function checkAppForUpdates(win: AppWindow = window): boolean {
  const app = win.webkit?.messageHandlers?.hiChat ?? win.chrome?.webview
  if (!app) return false
  app.postMessage({ checkForUpdates: true })
  return true
}

/**
 * Escape on the page throws a recording away; inside the Mac or Windows app
 * the other keys arrive as calls. Returns the cleanup.
 */
export function listenForRemoteKeys(onNewChat?: () => void) {
  if (onNewChat) openNewChat = onNewChat
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.repeat && handleRemoteKey('Escape'))
      e.preventDefault()
  }
  window.addEventListener('keydown', onKey)
  const stopApp = connectApp()
  return () => {
    stopApp()
    window.removeEventListener('keydown', onKey)
  }
}
