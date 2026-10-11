import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSpeakerComposerReview } from '../useSpeakerComposerReview'
import {
  setQuestionControls,
  useSpeakerTranscription,
} from '../useSpeakerTranscription'
const sendNow = vi.fn(),
  discard = vi.fn(),
  expireReview = vi.fn()
let unregister: () => void
const propose = (text = 'How does DNS work?', id = 'q') =>
  useSpeakerTranscription
    .getState()
    .setPendingQuestion({
      id,
      text,
      complete: true,
      manual: false,
      requiresReview: true,
      reviewUntil: Date.now() + 3000,
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
    expireReview,
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
  it('hides after three seconds without sending or deleting scenario context', () => {
    propose()
    const { result } = renderHook(() => useSpeakerComposerReview(''))
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.showing).toBe(false)
    expect(result.current.available).toBe(false)
    expect(useSpeakerTranscription.getState().composerReviewVisible).toBe(false)
    expect(expireReview).toHaveBeenCalledWith('q', 'How does DNS work?')
    expect(useSpeakerTranscription.getState().pendingQuestion?.text).toBe(
      'How does DNS work?'
    )
    act(() => result.current.send())
    expect(sendNow).not.toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
  })
  it('replaces a proposal without the old timer hiding the new question', () => {
    propose()
    const { result } = renderHook(() => useSpeakerComposerReview(''))
    act(() => vi.advanceTimersByTime(2500))
    act(() => propose('What about caching?', 'q2'))
    act(() => vi.advanceTimersByTime(500))
    expect(result.current.showing).toBe(true)
    expect(result.current.text).toBe('What about caching?')
    act(() => vi.advanceTimersByTime(2500))
    expect(result.current.showing).toBe(false)
    expect(expireReview).toHaveBeenCalledTimes(1)
    expect(expireReview).toHaveBeenCalledWith('q2', 'What about caching?')
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
  it('keeps incomplete background hidden until there is question evidence', () => {
    useSpeakerTranscription
      .getState()
      .setPendingQuestion({
        id: 'q',
        text: 'Suppose three services fail.',
        complete: false,
        manual: false,
        reason: 'scenario',
      })
    const { result } = renderHook(() => useSpeakerComposerReview(''))
    expect(result.current.available).toBe(false)
    act(() => propose('Suppose three services fail. How do we recover?'))
    expect(result.current.showing).toBe(true)
  })
  it('discards only the proposal and removes stale shortcut visibility when disabled', () => {
    propose()
    const { result } = renderHook(() => useSpeakerComposerReview('My draft'))
    act(() => result.current.discard())
    expect(discard).toHaveBeenCalledTimes(1)
    expect(result.current.available).toBe(false)
    act(() => propose('Explain JVM.', 'q2'))
    act(() => result.current.select())
    expect(result.current.showing).toBe(true)
    act(() => useSpeakerTranscription.getState().setEnabled(false))
    expect(result.current.showing).toBe(false)
    expect(useSpeakerTranscription.getState().composerReviewVisible).toBe(false)
  })
  it('reviews uncertain standalone suggestions in the composer and expires them without sending', () => {
    useSpeakerTranscription.getState().suggest('What about caching?')
    const { result } = renderHook(() => useSpeakerComposerReview(''))
    expect(result.current.showing).toBe(true)
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current.available).toBe(false)
    expect(useSpeakerTranscription.getState().suggestions).toEqual([])
    expect(useSpeakerTranscription.getState().queue).toEqual([])
  })
})
