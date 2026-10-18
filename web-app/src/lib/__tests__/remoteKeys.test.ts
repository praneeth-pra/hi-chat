import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stepCode, handleRemoteKey, listenForRemoteKeys } from '../remoteKeys'
vi.mock('sonner', () => ({ toast: vi.fn() }))
const toggleDictation = vi.fn()
const discardRecording = vi.fn()
const dictationState = { status: 'idle' }
type Listener = (s: typeof dictationState, p: typeof dictationState) => void
const dictationListeners = new Set<Listener>()
const setDictationStatus = (status: string) => {
  const prev = { ...dictationState }
  dictationState.status = status
  dictationListeners.forEach((l) => l(dictationState, prev))
}
vi.mock('@/lib/dictation', () => ({
  toggleDictation: () => toggleDictation(),
  cancelDictation: () => discardRecording(),
  useDictation: {
    getState: () => dictationState,
    subscribe: (l: Listener) => {
      dictationListeners.add(l)
      return () => dictationListeners.delete(l)
    },
  },
}))
describe('remote keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dictationState.status = 'idle'
  })
  it('ignores keys the app does not send', () => {
    for (const key of ['F13', 'F16', 'F18', 'F19', 'F20', 'Shift+F20', 'Alt'])
      expect(handleRemoteKey(key)).toBe(false)
    expect(toggleDictation).not.toHaveBeenCalled()
  })
  it('only Escape is taken from the keyboard; other keys pass through', () => {
    const stop = listenForRemoteKeys()
    const f14 = new KeyboardEvent('keydown', { key: 'F14', cancelable: true })
    window.dispatchEvent(f14)
    expect(toggleDictation).not.toHaveBeenCalled()
    expect(f14.defaultPrevented).toBe(false)
    stop()
  })
  it('F15 sends typed text and never submits when the button is disabled', () => {
    const button = document.createElement('button')
    button.setAttribute('data-test-id', 'send-message-button')
    const click = vi.fn()
    button.addEventListener('click', click)
    document.body.appendChild(button)
    expect(handleRemoteKey('F15')).toBe(true)
    expect(click).toHaveBeenCalledTimes(1)
    button.disabled = true
    handleRemoteKey('F15')
    expect(click).toHaveBeenCalledTimes(1)
    button.remove()
  })
  it('F14 toggles dictation', () => {
    expect(handleRemoteKey('F14')).toBe(true)
    expect(toggleDictation).toHaveBeenCalledTimes(1)
  })
  it('Escape or Shift+F13 discards a recording without sending it', () => {
    const stop = listenForRemoteKeys()
    const esc = new KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
    })
    window.dispatchEvent(esc)
    expect(discardRecording).not.toHaveBeenCalled()
    expect(esc.defaultPrevented).toBe(false)
    dictationState.status = 'recording'
    const esc2 = new KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
    })
    window.dispatchEvent(esc2)
    expect(discardRecording).toHaveBeenCalledTimes(1)
    expect(esc2.defaultPrevented).toBe(true)
    expect(handleRemoteKey('Shift+F13')).toBe(true)
    expect(discardRecording).toHaveBeenCalledTimes(2)
    dictationState.status = 'idle'
    expect(handleRemoteKey('Shift+F13')).toBe(true)
    expect(discardRecording).toHaveBeenCalledTimes(2)
    stop()
  })
  it('F17 focuses the chat box with the cursor at the end', () => {
    const box = document.createElement('textarea')
    box.dataset.testid = 'chat-input'
    box.value = 'draft'
    document.body.appendChild(box)
    expect(handleRemoteKey('F17')).toBe(true)
    expect(document.activeElement).toBe(box)
    expect(box.selectionStart).toBe(5)
    box.remove()
  })

  it('Shift + F16 / F17 step to the code block above / below', () => {
    const scrolled: string[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
    // Blocks at 100, 300 and 500 px; the chat's top line is at 16 px
    const tops: Record<string, number> = { one: 100, two: 300, three: 500 }
    let offset = 0
    for (const id of Object.keys(tops)) {
      const block = document.createElement('div')
      block.id = id
      block.setAttribute('data-code-block', '')
      block.getBoundingClientRect = () =>
        ({ top: tops[id] - offset, bottom: tops[id] - offset + 50 }) as DOMRect
      document.body.appendChild(block)
    }
    // Scrolled to the bottom: everything is above
    offset = 1000
    handleRemoteKey('Shift+F16')
    expect(scrolled).toEqual(['three'])

    // Quick presses keep stepping from where it was heading
    stepCode(-1, 10_000)
    stepCode(-1, 10_500)
    stepCode(-1, 10_900)
    expect(scrolled).toEqual(['three', 'three', 'two', 'one'])

    // Later on, with the last one off screen: block two is at the top, so
    // down goes to three
    offset = 284
    stepCode(1, 20_000)
    expect(scrolled.at(-1)).toBe('three')
    // Three is on screen: up steps on from it
    stepCode(-1, 30_000)
    expect(scrolled.at(-1)).toBe('two')

    // At the end of the chat blocks can't reach the top: down still moves on
    offset = 200
    stepCode(1, 40_000)
    expect(scrolled.at(-1)).toBe('three')
    const count = scrolled.length
    stepCode(1, 50_000)
    expect(scrolled.length).toBe(count) // No code below
    document.querySelectorAll('[data-code-block]').forEach((b) => b.remove())
  })
})

describe('app bridge', () => {
  it('does nothing in a browser', async () => {
    const { connectApp } = await import('../remoteKeys')
    const win = {} as Window & { hiChatRemote?: unknown }
    connectApp(win)()
    expect(win.hiChatRemote).toBeUndefined()
  })

  it('exposes the keys and reports dictation status to the app', async () => {
    const { connectApp, handleRemoteKey } = await import('../remoteKeys')
    const sent: unknown[] = []
    const win = {
      webkit: {
        messageHandlers: {
          hiChat: { postMessage: (m: unknown) => sent.push(m) },
        },
      },
    } as unknown as Window & { hiChatRemote?: unknown }
    const stop = connectApp(win)
    expect(win.hiChatRemote).toBe(handleRemoteKey)
    expect(sent).toEqual([{ dictation: 'idle' }])
    setDictationStatus('recording')
    expect(sent.at(-1)).toEqual({ dictation: 'recording' })
    setDictationStatus('idle')
    stop()
    setDictationStatus('recording')
    expect(sent).toHaveLength(3)
    setDictationStatus('idle')
    expect(win.hiChatRemote).toBeUndefined()
  })

  it('lets the app say when typing into Hi-chat is on', async () => {
    const { connectApp, useAppTyping } = await import('../remoteKeys')
    const win = {
      chrome: { webview: { postMessage: () => {} } },
    } as unknown as Window & { hiChatTyping?: (on: boolean) => void }
    const stop = connectApp(win)
    expect(useAppTyping.getState()).toEqual({ inApp: true, typing: false })
    win.hiChatTyping!(true)
    expect(useAppTyping.getState().typing).toBe(true)
    stop()
    expect(useAppTyping.getState()).toEqual({ inApp: false, typing: false })
  })

  it('talks to the Windows app through WebView2', async () => {
    const { connectApp, handleRemoteKey } = await import('../remoteKeys')
    const sent: unknown[] = []
    const win = {
      chrome: { webview: { postMessage: (m: unknown) => sent.push(m) } },
    } as unknown as Window & { hiChatRemote?: unknown }
    const stop = connectApp(win)
    expect(win.hiChatRemote).toBe(handleRemoteKey)
    expect(sent).toEqual([{ dictation: 'idle' }])
    stop()
  })
})
