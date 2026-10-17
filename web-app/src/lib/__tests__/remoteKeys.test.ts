import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useBackgroundTyping } from '@/hooks/useBackgroundTyping'
import {
  stepCode,
  handleRemoteKey,
  listenForRemoteKeys,
  stripFunctionKeyChars,
  takeDictationPaste,
  cancelDictation,
} from '../remoteKeys'
vi.mock('sonner', () => ({ toast: vi.fn() }))
const toggleDictation = vi.fn()
const stopDictation = vi.fn()
const discardRecording = vi.fn()
const dictationState = { status: 'idle' }
vi.mock('@/lib/dictation', () => ({
  toggleDictation: () => toggleDictation(),
  stopDictation: () => stopDictation(),
  cancelDictation: () => discardRecording(),
  useDictation: { getState: () => dictationState },
}))
describe('remote keys without Speaker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cancelDictation()
    useBackgroundTyping.getState().disable()
  })
  afterEach(() => {
    useBackgroundTyping.getState().disable()
    vi.useRealTimers()
  })
  it('ignores retired recommendation keys and ordinary Option/arrows', () => {
    for (const key of [
      'F16',
      'Shift+F15',
      'Shift+F18',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'Alt',
    ])
      expect(handleRemoteKey(key)).toBe(false)
    expect(toggleDictation).not.toHaveBeenCalled()
  })
  it('leaves Option, arrows and retired recommendation keys unconsumed', () => {
    const stop = listenForRemoteKeys()
    for (const key of [
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'Alt',
      'F16',
    ]) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    for (const key of ['F15', 'F18']) {
      const event = new KeyboardEvent('keydown', {
        key,
        shiftKey: true,
        cancelable: true,
      })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    stop()
  })
  it('F18/F19 set only the typing indicator, including Safari key codes', () => {
    const stop = listenForRemoteKeys()
    for (const key of ['F18', 'F18']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key }))
      expect(useBackgroundTyping.getState().enabled).toBe(true)
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F19' }))
    expect(useBackgroundTyping.getState().enabled).toBe(false)
    for (const keyCode of [129, 130]) {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Unidentified', keyCode })
      )
      expect(useBackgroundTyping.getState().enabled).toBe(keyCode === 129)
    }
    expect(toggleDictation).not.toHaveBeenCalled()
    expect(stopDictation).not.toHaveBeenCalled()
    stop()
  })
  it('expires stale typing status and renews it without toggling', () => {
    vi.useFakeTimers()
    handleRemoteKey('F18')
    vi.advanceTimersByTime(4000)
    handleRemoteKey('F18')
    vi.advanceTimersByTime(4000)
    expect(useBackgroundTyping.getState().enabled).toBe(true)
    vi.advanceTimersByTime(2000)
    expect(useBackgroundTyping.getState().enabled).toBe(false)
    handleRemoteKey('F18')
    handleRemoteKey('F19')
    vi.advanceTimersByTime(6000)
    expect(useBackgroundTyping.getState().enabled).toBe(false)
  })
  it('F15 sends typed text and never submits when the button is disabled', () => {
    const button = document.createElement('button')
    button.setAttribute('data-test-id', 'send-message-button')
    const click = vi.fn()
    button.addEventListener('click', click)
    document.body.appendChild(button)
    const stop = listenForRemoteKeys()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F15' }))
    expect(click).toHaveBeenCalledTimes(1)
    button.disabled = true
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F15' }))
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F15', repeat: true })
    )
    expect(click).toHaveBeenCalledTimes(1)
    stop()
    button.remove()
  })
  it('F14 toggles dictation and F13 stops it, also by key code', () => {
    const stop = listenForRemoteKeys()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F14' }))
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 125 })
    )
    expect(toggleDictation).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F13' }))
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 124 })
    )
    expect(stopDictation).toHaveBeenCalledTimes(2)
    stop()
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
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F13', shiftKey: true })
    )
    expect(discardRecording).toHaveBeenCalledTimes(2)
    expect(stopDictation).not.toHaveBeenCalled()
    dictationState.status = 'idle'
    expect(handleRemoteKey('Shift+F13')).toBe(true)
    expect(discardRecording).toHaveBeenCalledTimes(2)
    stop()
  })

  it('F20 focuses the chat box with the cursor at the end', () => {
    const box = document.createElement('textarea')
    box.dataset.testid = 'chat-input'
    box.value = 'draft'
    document.body.appendChild(box)
    const stop = listenForRemoteKeys()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F20' }))
    expect(document.activeElement).toBe(box)
    expect(box.selectionStart).toBe(5)

    stop()
    box.remove()
  })
  it('accepts F20 that Safari reports only by key code', () => {
    const box = document.createElement('textarea')
    box.dataset.testid = 'chat-input'
    document.body.appendChild(box)
    const stop = listenForRemoteKeys()

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 131 })
    )
    expect(document.activeElement).toBe(box)

    stop()
    box.remove()
  })

  it('strips function-key characters Safari types into the box', () => {
    expect(stripFunctionKeyChars('\uF717Can you explain ECS?')).toBe(
      'Can you explain ECS?'
    )
    expect(stripFunctionKeyChars('plain text')).toBe('plain text')
  })
  it('treats one paste after F20 as dictation', () => {
    const box = document.createElement('textarea')
    box.dataset.testid = 'chat-input'
    document.body.appendChild(box)
    const stop = listenForRemoteKeys()
    const pressF20 = () =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F20' }))

    cancelDictation() // earlier tests pressed F20
    expect(takeDictationPaste()).toBe(false)
    pressF20()
    expect(takeDictationPaste()).toBe(true)
    expect(takeDictationPaste()).toBe(false)

    pressF20()
    cancelDictation()
    expect(takeDictationPaste()).toBe(false)

    pressF20()
    expect(takeDictationPaste(Date.now() + 4 * 60 * 1000)).toBe(false)

    stop()
    box.remove()
  })
  it('F17 focuses the chat box but leaves a paste as a draft', () => {
    const box = document.createElement('textarea')
    box.dataset.testid = 'chat-input'
    document.body.appendChild(box)
    const stop = listenForRemoteKeys()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F20' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F17' }))
    expect(document.activeElement).toBe(box)
    expect(takeDictationPaste()).toBe(false)

    stop()
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
    const stop = listenForRemoteKeys()
    const press = (key: string) =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey: true })
      )

    // Scrolled to the bottom: everything is above
    offset = 1000
    press('F16')
    expect(scrolled).toEqual(['three'])
    stop()

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

  it('Shift + F20 clicks what is under the pointer, focusing a text box', () => {
    const button = document.createElement('button')
    const box = document.createElement('textarea')
    document.body.append(button, box)
    const clicked = vi.fn()
    button.addEventListener('click', clicked)
    let under: Element = button
    document.elementFromPoint = () => under
    const stop = listenForRemoteKeys()
    const press = () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F20', shiftKey: true })
      )

    // No pointer seen over the page yet: nothing is clicked
    press()
    expect(clicked).not.toHaveBeenCalled()

    window.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 40, clientY: 60 })
    )
    press()
    expect(clicked).toHaveBeenCalledTimes(1)

    under = box
    press()
    expect(document.activeElement).toBe(box)
    stop()
    button.remove()
    box.remove()
  })
})
