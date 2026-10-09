import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSpeakerTranscription } from '@/hooks/useSpeakerTranscription'
import {
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
    expect(useSpeakerTranscription.getState().suggestions).toEqual([
      'Can you show me?',
    ])
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
})
