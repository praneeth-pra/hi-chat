import { toast } from 'sonner'
import {
  cancelDictation as discardRecording,
  stopDictation,
  toggleDictation,
  useDictation,
} from '@/lib/dictation'
import { useBackgroundTyping } from '@/hooks/useBackgroundTyping'

/**
 * Keys a helper like Hammerspoon can send to this tab while another app is
 * in front. F13–F20 aren't on Mac laptop keyboards, so nothing typed by
 * hand triggers them.
 */
export const FOCUS_CHAT_KEY = 'F20'
/** Like F20, but the dictated text stays in the box for you to send. */
export const FOCUS_CHAT_DRAFT_KEY = 'F17'
/** Explicit status signals, not toggles: neither records nor sends anything. */
export const BACKGROUND_TYPING_ON_KEY = 'F18'
export const BACKGROUND_TYPING_OFF_KEY = 'F19'
/**
 * F14 starts dictating your own voice and, pressed again, stops and
 * sends the text; F13 only stops. Hammerspoon sends F14 on a tap of Left
 * Control.
 */
export const SEND_KEY = 'F15'
export const DICTATION_TOGGLE_KEY = 'F14'
export const DICTATION_STOP_KEY = 'F13'
/**
 * Escape, or Shift + F13 from Hammerspoon's Escape while you dictate, throws
 * the recording away without sending it.
 */
export const DICTATION_CANCEL_KEY = 'Shift+F13'
/**
 * Shift + F16 scrolls to the code block above, Shift + F17 to the one below,
 * so pressing one again steps on through the chat's code. Hammerspoon sends
 * them on fn + Up and fn + Down.
 */
export const CODE_UP_KEY = 'Shift+F16'
export const CODE_DOWN_KEY = 'Shift+F17'
/**
 * Shift + F20 presses the mouse at the pointer and Shift + F19 lets it go.
 * While Option typing is on, Hammerspoon sends them in place of a real click,
 * which Safari would only take by becoming the active app. Let go where it was
 * pressed, it clicks (twice selects a word, three times a paragraph); dragged
 * in between, it selects the text from there to here.
 */
export const POINTER_DOWN_KEY = 'Shift+F20'
export const POINTER_UP_KEY = 'Shift+F19'

/** Where the pointer last was over this page (Safari reports moves even while in the background). */
let pointerAt: { x: number; y: number } | null = null
/** The press being held, with where the selection starts. */
let pressed: { x: number; y: number; anchor: Range | null } | null = null
/** Recent presses at one spot, for double and triple clicks. */
let presses = { at: 0, x: 0, y: 0, count: 0 }
const DRAG_PX = 4
const MULTI_CLICK_MS = 400

function caretAt(x: number, y: number): Range | null {
  const range = document.caretRangeFromPoint?.(x, y)
  return range ?? null
}

/** Starts a press at the pointer; returns true. */
export function pressAtPointer(): boolean {
  if (!pointerAt) {
    toast('Move the pointer over Hi-chat, then click')
    return true
  }
  const { x, y } = pointerAt
  pressed = { x, y, anchor: caretAt(x, y) }
  return true
}

/** While pressed, selects from where the press began to the pointer. */
function dragTo(x: number, y: number) {
  if (!pressed?.anchor) return
  if (Math.hypot(x - pressed.x, y - pressed.y) < DRAG_PX) return
  const focus = caretAt(x, y)
  if (!focus) return
  window
    .getSelection()
    ?.setBaseAndExtent(
      pressed.anchor.startContainer,
      pressed.anchor.startOffset,
      focus.startContainer,
      focus.startOffset
    )
}

function selectAround(x: number, y: number, count: number) {
  const caret = caretAt(x, y)
  const selection = window.getSelection()
  if (!caret || !selection) return
  if (count === 2) {
    selection.collapse(caret.startContainer, caret.startOffset)
    selection.modify?.('move', 'backward', 'word')
    selection.modify?.('extend', 'forward', 'word')
    return
  }
  const node = caret.startContainer
  const element = node instanceof Element ? node : node.parentElement
  const block = element?.closest(
    'p, li, pre, h1, h2, h3, h4, h5, h6, td, blockquote'
  )
  if (block) selection.selectAllChildren(block)
}

/** Ends the press: a click where it began, or the dragged selection stays. */
export function releaseAtPointer(): boolean {
  const press = pressed
  pressed = null
  if (!press) return true
  const at = pointerAt ?? press
  if (Math.hypot(at.x - press.x, at.y - press.y) >= DRAG_PX) return true
  const now = Date.now()
  const again =
    now - presses.at < MULTI_CLICK_MS &&
    Math.hypot(press.x - presses.x, press.y - presses.y) < DRAG_PX
  presses = {
    at: now,
    x: press.x,
    y: press.y,
    count: again ? presses.count + 1 : 1,
  }
  if (presses.count > 1) {
    selectAround(press.x, press.y, Math.min(presses.count, 3))
    return true
  }
  return clickAt(press.x, press.y)
}

/** Clicks the element at that spot; returns true. */
function clickAt(x: number, y: number): boolean {
  const target = document.elementFromPoint(x, y)
  if (!(target instanceof HTMLElement)) return true
  if (target.matches('input, textarea, [contenteditable="true"]')) {
    target.focus()
  } else {
    // A plain click clears an old selection, as a real one would.
    window.getSelection()?.removeAllRanges()
  }
  target.click()
  return true
}

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

/** How long after F20 a paste counts as dictation. */
const DICTATION_WINDOW_MS = 3 * 60 * 1000
let dictationUntil = 0

/**
 * True once for a paste that follows F20: the helper focused the box for a
 * dictation app, so the pasted text is a question to send, not a draft.
 */
export function takeDictationPaste(now = Date.now()): boolean {
  const armed = now < dictationUntil
  dictationUntil = 0
  return armed
}

/** Typing by hand means the box is being used normally again. */
export function cancelDictation() {
  dictationUntil = 0
}

/** Puts the cursor at the end of the chat box, ready for dictation. */
function focusChatBox(sendPaste: boolean): boolean {
  const box = document.querySelector<HTMLTextAreaElement>(
    '[data-testid="chat-input"]'
  )
  if (!box) return false
  box.focus()
  box.setSelectionRange(box.value.length, box.value.length)
  dictationUntil = sendPaste ? Date.now() + DICTATION_WINDOW_MS : 0
  return true
}

/**
 * Safari can type a function key into a text box as an invisible
 * private-use character (shown as a crossed box) when the page doesn't
 * catch it. Strips those characters from typed text.
 */
export function stripFunctionKeyChars(text: string): string {
  return text.replace(/[\uF700-\uF8FF]/g, '')
}

/** Safari may report F13 and up as "Unidentified"; fall back to the key code. */
function keyName(e: KeyboardEvent): string {
  const fKey = /^F\d+$/
  if (fKey.test(e.key)) return e.key
  if (fKey.test(e.code)) return e.code
  const byCode: Record<number, string> = {
    124: 'F13',
    125: 'F14',
    126: 'F15',
    127: 'F16',
    128: 'F17',
    129: 'F18',
    130: 'F19',
    131: 'F20',
  }
  return byCode[e.keyCode] ?? e.key
}

/** Dictation, explicit send and navigation shortcuts. */
export function handleRemoteKey(key: string): boolean {
  if (key === BACKGROUND_TYPING_ON_KEY) {
    useBackgroundTyping.getState().heartbeat()
    return true
  }
  if (key === BACKGROUND_TYPING_OFF_KEY) {
    useBackgroundTyping.getState().disable()
    return true
  }
  if (key === FOCUS_CHAT_KEY) return focusChatBox(true)
  if (key === FOCUS_CHAT_DRAFT_KEY) return focusChatBox(false)
  if (key === CODE_UP_KEY) return stepCode(-1)
  if (key === CODE_DOWN_KEY) return stepCode(1)
  if (key === POINTER_DOWN_KEY) return pressAtPointer()
  if (key === POINTER_UP_KEY) return releaseAtPointer()
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
  if (key === DICTATION_STOP_KEY) {
    void stopDictation()
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

/** Listens for the keys on the whole page; returns the cleanup. */
export function listenForRemoteKeys() {
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat) return
    const name = keyName(e)
    if (handleRemoteKey(e.shiftKey ? `Shift+${name}` : name)) e.preventDefault()
  }
  const onMove = (e: PointerEvent) => {
    pointerAt = { x: e.clientX, y: e.clientY }
    if (pressed) dragTo(e.clientX, e.clientY)
  }
  const onLeave = () => {
    pointerAt = null
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('pointermove', onMove, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeave)
  return () => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('pointermove', onMove)
    document.documentElement.removeEventListener('pointerleave', onLeave)
  }
}
