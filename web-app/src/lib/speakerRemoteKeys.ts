import { toast } from 'sonner'
import { useSpeakerTranscription } from '@/hooks/useSpeakerTranscription'
import { stopDictation, toggleDictation } from '@/lib/dictation'

/**
 * Keys a helper like Hammerspoon can send to this tab while another app is
 * in front. F18 and F19 aren't on Mac laptop keyboards, so nothing typed by
 * hand triggers them.
 */
export const CODING_KEY = 'F18'
export const LISTEN_KEY = 'F19'
export const FOCUS_CHAT_KEY = 'F20'
/** Like F20, but the dictated text stays in the box for you to send. */
export const FOCUS_CHAT_DRAFT_KEY = 'F17'
/** Sends everything heard since the last sent question as one question. */
export const SCENARIO_KEY = 'F16'
/**
 * Sends what's typed in the chat box, or when it's empty the newest
 * suggestion chip (a clip the two judges disagreed on).
 */
export const SUGGESTION_KEY = 'F15'
/**
 * F14 starts dictating your own voice and, pressed again, stops and
 * sends the text; F13 only stops. Hammerspoon sends F14 on a tap of Left
 * Control.
 */
export const DICTATION_TOGGLE_KEY = 'F14'
export const DICTATION_STOP_KEY = 'F13'
/**
 * Shift + F16 scrolls to the last code block in the chat; pressed again
 * within a few seconds, to the one before it. Hammerspoon sends it on fn + K.
 */
export const LAST_CODE_KEY = 'Shift+F16'

let scenarioSender: (() => string | null) | null = null

/** The speaker listener registers how to send the scenario; returns the cleanup. */
export function setScenarioSender(send: () => string | null) {
  scenarioSender = send
  return () => {
    if (scenarioSender === send) scenarioSender = null
  }
}

function sendScenario(): boolean {
  if (!scenarioSender) {
    toast('Speaker is off')
    return true
  }
  const text = scenarioSender()
  if (!text) {
    toast('Nothing new heard since the last question')
    return true
  }
  useSpeakerTranscription.getState().enqueue(text)
  toast('Sent scenario')
  return true
}

const CODE_AGAIN_MS = 5000
let codeJump = { at: 0, index: -1 }

/** Scrolls to the last code block, or the one before the last jump's. */
export function jumpToCode(now = Date.now()): boolean {
  const blocks = Array.from(
    document.querySelectorAll<HTMLElement>('[data-code-block]')
  )
  if (!blocks.length) {
    toast('No code in this chat')
    return true
  }
  const since = now - codeJump.at
  const again =
    since >= 0 && since < CODE_AGAIN_MS && codeJump.index < blocks.length
  const index = again ? Math.max(0, codeJump.index - 1) : blocks.length - 1
  if (again && index === codeJump.index) toast('This is the first code block')
  codeJump = { at: now, index }
  blocks[index].scrollIntoView({ block: 'start', behavior: 'smooth' })
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

/** Toggles coding mode or listening, focuses the chat box, sends the scenario or jumps to code; returns false for any other key. */
export function handleSpeakerKey(key: string): boolean {
  if (key === FOCUS_CHAT_KEY) return focusChatBox(true)
  if (key === FOCUS_CHAT_DRAFT_KEY) return focusChatBox(false)
  if (key === SCENARIO_KEY) return sendScenario()
  if (key === LAST_CODE_KEY) return jumpToCode()
  if (key === DICTATION_TOGGLE_KEY) {
    toggleDictation()
    return true
  }
  if (key === DICTATION_STOP_KEY) {
    void stopDictation()
    return true
  }
  const state = useSpeakerTranscription.getState()
  if (key === SUGGESTION_KEY) {
    const send = document.querySelector<HTMLButtonElement>(
      '[data-test-id="send-message-button"]'
    )
    if (send && !send.disabled) {
      send.click()
      return true
    }
    const [newest] = state.suggestions
    if (newest) {
      state.acceptSuggestion(newest)
      toast('Sent suggestion')
    } else toast('Nothing to send')
    return true
  }
  if (key === CODING_KEY) {
    state.setCoding(!state.coding)
    toast(`Coding mode ${state.coding ? 'off' : 'on'}`)
    return true
  }
  if (key === LISTEN_KEY) {
    state.setEnabled(!state.enabled)
    toast(`Speaker ${state.enabled ? 'off' : 'on'}`)
    return true
  }
  return false
}

/** Listens for the keys on the whole page; returns the cleanup. */
export function listenForSpeakerKeys() {
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat) return
    const name = keyName(e)
    if (handleSpeakerKey(e.shiftKey ? `Shift+${name}` : name))
      e.preventDefault()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
