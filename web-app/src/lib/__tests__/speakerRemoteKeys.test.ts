import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  setQuestionControls,
  useSpeakerTranscription,
} from '@/hooks/useSpeakerTranscription'
import {
  stepCode,
  listenForSpeakerKeys,
  stripFunctionKeyChars,
  takeDictationPaste,
  cancelDictation,
  setScenarioSender,
} from '../speakerRemoteKeys'

vi.mock('sonner', () => ({ toast: vi.fn() }))
const toggleDictation = vi.fn()
const stopDictation = vi.fn()
vi.mock('@/lib/dictation', () => ({
  toggleDictation: () => toggleDictation(),
  stopDictation: () => stopDictation(),
}))

describe('speaker remote keys', () => {
  beforeEach(() =>
    useSpeakerTranscription.setState({ coding: false, enabled: true })
  )

  it('F18 toggles coding mode and F19 toggles listening', () => {
    const stop = listenForSpeakerKeys()
    const press = (key: string) =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key }))

    press('F18')
    expect(useSpeakerTranscription.getState().coding).toBe(true)
    press('F18')
    expect(useSpeakerTranscription.getState().coding).toBe(false)

    press('F19')
    expect(useSpeakerTranscription.getState().enabled).toBe(false)

    press('a')
    expect(useSpeakerTranscription.getState().enabled).toBe(false)

    stop()
    press('F18')
    expect(useSpeakerTranscription.getState().coding).toBe(false)
  })
  it('Shift + F15 sends only the newest recommendation even when a typed draft can be sent', () => {
    useSpeakerTranscription.getState().resetTurns()
    useSpeakerTranscription.getState().setComposerReviewVisible(true)
    useSpeakerTranscription.getState().suggest('Older question')
    useSpeakerTranscription.getState().suggest('Latest question')
    const button = document.createElement('button')
    button.setAttribute('data-test-id', 'send-message-button')
    const click = vi.fn()
    button.addEventListener('click', click)
    document.body.appendChild(button)
    const stop = listenForSpeakerKeys()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F15', shiftKey: true })
    )
    expect(click).not.toHaveBeenCalled()
    expect(useSpeakerTranscription.getState().queue).toEqual([
      'Latest question',
    ])
    expect(useSpeakerTranscription.getState().suggestions).toEqual([])
    stop()
    button.remove()
  })
  it('Shift + F18 discards one recommendation without toggling coding/listening or repeating', () => {
    useSpeakerTranscription.getState().resetTurns()
    useSpeakerTranscription.getState().setComposerReviewVisible(true)
    useSpeakerTranscription.getState().suggest('Older question')
    useSpeakerTranscription.getState().suggest('Latest question')
    const stop = listenForSpeakerKeys()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F18', shiftKey: true })
    )
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F18', shiftKey: true, repeat: true })
    )
    expect(useSpeakerTranscription.getState().suggestions).toEqual([])
    expect(useSpeakerTranscription.getState().coding).toBe(false)
    expect(useSpeakerTranscription.getState().enabled).toBe(true)
    expect(useSpeakerTranscription.getState().queue).toEqual([])
    stop()
  })
  it('fn arrow commands act on the pending question before older recommendations', () => {
    useSpeakerTranscription.getState().resetTurns()
    useSpeakerTranscription.getState().setComposerReviewVisible(true)
    useSpeakerTranscription.getState().suggest('What is DNS?')
    useSpeakerTranscription.getState().setPendingQuestion({
      id: 'building',
      text: 'How would you recover if',
      complete: false,
      manual: false,
      reason: 'scenario',
    })
    useSpeakerTranscription.getState().setComposerReviewVisible(true)
    const sendNow = vi.fn(),
      discard = vi.fn()
    const unregister = setQuestionControls({
      sendNow,
      discard,
      keepListening: vi.fn(),
    })
    const stop = listenForSpeakerKeys()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F15', shiftKey: true })
    )
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F18', shiftKey: true })
    )
    expect(sendNow).toHaveBeenCalledTimes(1)
    expect(discard).toHaveBeenCalledTimes(1)
    expect(useSpeakerTranscription.getState().suggestions).toEqual([
      'What is DNS?',
    ])
    expect(useSpeakerTranscription.getState().queue).toEqual([])
    stop()
    unregister()
    useSpeakerTranscription.getState().resetTurns()
    useSpeakerTranscription.getState().setComposerReviewVisible(true)
  })
  it('can approve a persistent complete question after long pauses', () => {
    useSpeakerTranscription.getState().resetTurns()
    useSpeakerTranscription.getState().setComposerReviewVisible(true)
    useSpeakerTranscription.getState().setPendingQuestion({
      id: 'review',
      text: 'Which one is cheaper?',
      complete: true,
      manual: false,
      requiresReview: true,
      reason: 'follow-up',
    })
    useSpeakerTranscription.getState().setComposerReviewVisible(true)
    const sendNow = vi.fn()
    const unregister = setQuestionControls({
      sendNow,
      discard: vi.fn(),
      keepListening: vi.fn(),
    })
    const stop = listenForSpeakerKeys()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F15', shiftKey: true })
    )
    expect(sendNow).toHaveBeenCalledTimes(1)
    stop()
    unregister()
    useSpeakerTranscription.getState().resetTurns()
    useSpeakerTranscription.getState().setComposerReviewVisible(true)
  })
  it('cannot approve a changed draft before it renders in the composer', () => {
    useSpeakerTranscription.getState().resetTurns()
    const draft = {
      id: 'q',
      text: 'Explain DNS.',
      complete: true,
      manual: false,
      reason: 'question',
    }
    useSpeakerTranscription.getState().setPendingQuestion(draft)
    useSpeakerTranscription.getState().setComposerReviewVisible(true)
    const sendNow = vi.fn()
    const unregister = setQuestionControls({
      sendNow,
      discard: vi.fn(),
      keepListening: vi.fn(),
    })
    const stop = listenForSpeakerKeys()
    useSpeakerTranscription
      .getState()
      .setPendingQuestion({ ...draft, text: 'Explain DNS. And caching?' })
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F15', shiftKey: true })
    )
    expect(sendNow).not.toHaveBeenCalled()
    useSpeakerTranscription.getState().setComposerReviewVisible(true)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F15', shiftKey: true })
    )
    expect(sendNow).toHaveBeenCalledTimes(1)
    stop()
    unregister()
    useSpeakerTranscription.getState().resetTurns()
  })
  it('fn arrows never send or discard a hidden proposal while typing a draft', () => {
    useSpeakerTranscription.getState().resetTurns()
    useSpeakerTranscription.getState().suggest('What is DNS?')
    useSpeakerTranscription.getState().setComposerReviewVisible(false)
    const stop = listenForSpeakerKeys()
    for (const key of ['F15', 'F18'])
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey: true })
      )
    expect(useSpeakerTranscription.getState().queue).toEqual([])
    expect(useSpeakerTranscription.getState().suggestions).toEqual([
      'What is DNS?',
    ])
    stop()
  })
  it('plain side arrows never control the speaker or prevent normal navigation', () => {
    useSpeakerTranscription.getState().resetTurns()
    useSpeakerTranscription.getState().setComposerReviewVisible(true)
    useSpeakerTranscription.getState().suggest('What is DNS?')
    const stop = listenForSpeakerKeys()
    for (const key of ['ArrowLeft', 'ArrowRight']) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true })
      window.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(useSpeakerTranscription.getState().suggestions).toEqual([
      'What is DNS?',
    ])
    expect(useSpeakerTranscription.getState().queue).toEqual([])
    stop()
    useSpeakerTranscription.getState().resetTurns()
    useSpeakerTranscription.getState().setComposerReviewVisible(true)
  })
  it('F15 sends the newest suggestion chip', () => {
    useSpeakerTranscription.setState({ queue: [], suggestions: [] })
    const stop = listenForSpeakerKeys()
    const press = (key: string) =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key }))
    press('F15')
    expect(useSpeakerTranscription.getState().queue).toEqual([])
    useSpeakerTranscription.getState().suggest('Can you show me?')
    useSpeakerTranscription.getState().suggest('What is a pod?')
    press('F15')
    // No listener registered: the suggestion goes straight to the queue
    expect(useSpeakerTranscription.getState().queue).toEqual(['What is a pod?'])
    expect(useSpeakerTranscription.getState().suggestions).toEqual([])
    stop()
  })

  it('F15 sends the typed text first, when the chat box has some', () => {
    useSpeakerTranscription.setState({ queue: [], suggestions: [] })
    useSpeakerTranscription.getState().suggest('What is a pod?')
    const button = document.createElement('button')
    button.setAttribute('data-test-id', 'send-message-button')
    const click = vi.fn()
    button.addEventListener('click', click)
    document.body.appendChild(button)
    const stop = listenForSpeakerKeys()
    const press = () =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F15' }))

    press()
    expect(click).toHaveBeenCalledTimes(1)
    expect(useSpeakerTranscription.getState().suggestions).toEqual([
      'What is a pod?',
    ])

    // An empty box disables the send button: the chip goes instead
    button.disabled = true
    press()
    expect(click).toHaveBeenCalledTimes(1)
    expect(useSpeakerTranscription.getState().queue).toEqual(['What is a pod?'])
    stop()
    button.remove()
  })

  it('F14 toggles dictation and F13 stops it, also by key code', () => {
    const stop = listenForSpeakerKeys()
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

  it('F16 sends the scenario the listener hands over', () => {
    useSpeakerTranscription.setState({ queue: [] })
    const stop = listenForSpeakerKeys()
    const press = () =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F16' }))
    let next: string | null = 'Let us say X. How would you test it?'
    const unregister = setScenarioSender(() => {
      const text = next
      next = null
      return text
    })
    press()
    press() // nothing new: nothing queued
    expect(useSpeakerTranscription.getState().queue).toEqual([
      'Let us say X. How would you test it?',
    ])
    unregister()
    stop()
  })
  it('F20 focuses the chat box with the cursor at the end', () => {
    const box = document.createElement('textarea')
    box.dataset.testid = 'chat-input'
    box.value = 'draft'
    document.body.appendChild(box)
    const stop = listenForSpeakerKeys()

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
    const stop = listenForSpeakerKeys()

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
    const stop = listenForSpeakerKeys()
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
    const stop = listenForSpeakerKeys()

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
    const stop = listenForSpeakerKeys()
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
})
