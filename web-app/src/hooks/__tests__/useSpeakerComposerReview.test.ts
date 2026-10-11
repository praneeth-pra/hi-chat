import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSpeakerComposerReview } from '../useSpeakerComposerReview'
import {
  setQuestionControls,
  useSpeakerTranscription,
} from '../useSpeakerTranscription'
const sendNow = vi.fn(),
  discard = vi.fn()
let unregister: () => void
const propose = (text = 'How does DNS work?', id = 'q') =>
  useSpeakerTranscription.getState().setPendingQuestion({
    id,
    text,
    complete: true,
    manual: false,
    requiresReview: true,
    reason: 'question',
  })
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  useSpeakerTranscription.getState().resetTurns()
  useSpeakerTranscription.getState().setEnabled(true)
  unregister = setQuestionControls({
    sendNow,
    discard,
    keepListening: vi.fn(),
  })
})
afterEach(() => {
  unregister()
  vi.useRealTimers()
})
describe('speaker composer review', () => {
  it('shows a question in an empty composer and sends only on explicit approval', () => {
    propose()
    const { result } = renderHook(() => useSpeakerComposerReview(''))
    expect(result.current.showing).toBe(true)
    expect(result.current.text).toBe('How does DNS work?')
    expect(useSpeakerTranscription.getState().composerReviewVisible).toBe(true)
    expect(sendNow).not.toHaveBeenCalled()
    act(() => result.current.send())
    expect(sendNow).toHaveBeenCalledTimes(1)
  })
  it('preserves a typed draft and offers an explicit switch to review', () => {
    propose()
    const { result } = renderHook(() => useSpeakerComposerReview('My draft'))
    expect(result.current.available).toBe(true)
    expect(result.current.showing).toBe(false)
    expect(useSpeakerTranscription.getState().composerReviewVisible).toBe(false)
    act(() => result.current.send())
    expect(sendNow).not.toHaveBeenCalled()
    act(() => result.current.select())
    expect(result.current.showing).toBe(true)
    act(() => result.current.back())
    expect(result.current.showing).toBe(false)
  })
  it('keeps a draft visible indefinitely and keeps a selected scenario stable as it grows', () => {
    propose()
    const { result } = renderHook(() => useSpeakerComposerReview('My draft'))
    act(() => result.current.select())
    act(() => vi.advanceTimersByTime(120000))
    act(() => propose('How does DNS work? What about caching?'))
    expect(result.current.showing).toBe(true)
    expect(result.current.text).toBe('How does DNS work? What about caching?')
    act(() => result.current.send())
    expect(sendNow).toHaveBeenCalledTimes(1)
  })
  it('previews streaming text but only finalized text can be approved', () => {
    const { result } = renderHook(() => useSpeakerComposerReview(''))
    act(() =>
      useSpeakerTranscription
        .getState()
        .setPreview({ clipId: 1, text: 'Suppose three services' })
    )
    expect(result.current.text).toBe('Suppose three services')
    expect(result.current.showing).toBe(true)
    expect(result.current.canSend).toBe(false)
    act(() => result.current.send())
    expect(sendNow).not.toHaveBeenCalled()
    act(() => {
      propose('Suppose three services fail.')
      useSpeakerTranscription.getState().setPreview(null)
    })
    expect(result.current.canSend).toBe(true)
  })
  it('keeps fn controls active on a complete draft while a later question streams', () => {
    propose()
    const { result } = renderHook(() => useSpeakerComposerReview(''))
    act(() =>
      useSpeakerTranscription
        .getState()
        .setPreview({ clipId: 8, text: 'A later question' })
    )
    expect(result.current.text).toBe('How does DNS work?')
    expect(result.current.canSend).toBe(true)
    expect(useSpeakerTranscription.getState().composerReviewVisible).toBe(true)
    act(() =>
      useSpeakerTranscription
        .getState()
        .setPreview({ clipId: 8, text: 'A later question about caching' })
    )
    expect(useSpeakerTranscription.getState().composerReviewVisible).toBe(true)
  })
  it('preserves review selection when a live preview finalizes beside a typed draft', () => {
    useSpeakerTranscription
      .getState()
      .setPreview({ clipId: 4, text: 'Suppose payment succeeds.' })
    const { result } = renderHook(() =>
      useSpeakerComposerReview('My typed draft')
    )
    act(() => result.current.select())
    expect(result.current.showing).toBe(true)
    act(() => {
      useSpeakerTranscription.getState().setPendingQuestion({
        id: 'q',
        clip: 4,
        text: 'Suppose payment succeeds.',
        complete: false,
        manual: false,
        reason: 'scenario',
      })
      useSpeakerTranscription.getState().setPreview(null)
    })
    expect(result.current.showing).toBe(true)
    act(() => propose('Suppose payment succeeds. How do we recover?'))
    expect(result.current.showing).toBe(true)
    act(() => result.current.back())
    expect(result.current.showing).toBe(false)
  })
  it('does not replace a typed draft with a newly arriving proposal after selection', () => {
    propose()
    const { result } = renderHook(() => useSpeakerComposerReview('My draft'))
    act(() => result.current.select())
    expect(result.current.showing).toBe(true)
    act(() => propose('Explain JVM.', 'q2'))
    expect(result.current.showing).toBe(false)
    expect(result.current.available).toBe(true)
  })
  it('shows incomplete scenario context persistently', () => {
    useSpeakerTranscription.getState().setPendingQuestion({
      id: 'q',
      text: 'Suppose three services fail.',
      complete: false,
      manual: false,
      reason: 'scenario',
    })
    const { result } = renderHook(() => useSpeakerComposerReview(''))
    expect(result.current.available).toBe(true)
    act(() => propose('Suppose three services fail. How do we recover?'))
    expect(result.current.showing).toBe(true)
  })
  it('discards only the proposal and removes stale shortcut visibility when disabled', () => {
    propose()
    const { result } = renderHook(() => useSpeakerComposerReview('My draft'))
    act(() => {
      result.current.discard()
      useSpeakerTranscription.getState().setPendingQuestion(null)
    })
    expect(discard).toHaveBeenCalledTimes(1)
    expect(result.current.available).toBe(false)
    act(() => propose('Explain JVM.', 'q2'))
    act(() => result.current.select())
    expect(result.current.showing).toBe(true)
    act(() => useSpeakerTranscription.getState().setEnabled(false))
    expect(result.current.showing).toBe(false)
    expect(useSpeakerTranscription.getState().composerReviewVisible).toBe(false)
  })
  it('reviews uncertain standalone suggestions in the composer and retains them without sending', () => {
    useSpeakerTranscription.getState().suggest('What about caching?')
    const { result } = renderHook(() => useSpeakerComposerReview(''))
    expect(result.current.showing).toBe(true)
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.available).toBe(true)
    expect(useSpeakerTranscription.getState().suggestions).toEqual([
      'What about caching?',
    ])
    expect(useSpeakerTranscription.getState().queue).toEqual([])
  })
})
