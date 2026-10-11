import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setQuestionControls,
  useSpeakerTranscription,
} from '@/hooks/useSpeakerTranscription'
import {
  SpeakerPendingQuestion,
  SpeakerSuggestions,
} from '../SpeakerListenIndicator'
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => false }))
const sendNow = vi.fn(),
  keepListening = vi.fn(),
  discard = vi.fn(),
  expireReview = vi.fn()
let unregister: () => void
beforeEach(() => {
  vi.clearAllMocks()
  useSpeakerTranscription.getState().resetTurns()
  useSpeakerTranscription.getState().setEnabled(true)
  unregister = setQuestionControls({
    sendNow,
    keepListening,
    discard,
    expireReview,
  })
})
afterEach(() => {
  unregister()
  vi.useRealTimers()
})
describe('pending question controls', () => {
  it('accumulates scenario background without displaying another review card', () => {
    useSpeakerTranscription.getState().setPendingQuestion({
      id: 'q',
      text: 'Suppose three services fail.',
      complete: false,
      manual: false,
      reason: 'scenario',
    })
    render(<SpeakerPendingQuestion />)
    expect(
      screen.queryByTestId('speaker-pending-question')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(useSpeakerTranscription.getState().pendingQuestion?.text).toBe(
      'Suppose three services fail.'
    )
  })
  it('keeps manual holds explicit and hides controls when disabled', () => {
    useSpeakerTranscription.getState().setPendingQuestion({
      id: 'q',
      text: 'Scenario',
      complete: true,
      manual: true,
      reason: 'manual',
    })
    const { rerender } = render(<SpeakerPendingQuestion />)
    expect(screen.getByText('Waiting for you to send')).toBeInTheDocument()
    expect(screen.getByText('fn + →')).toBeInTheDocument()
    act(() => useSpeakerTranscription.getState().setEnabled(false))
    rerender(<SpeakerPendingQuestion />)
    expect(screen.queryByText('Scenario')).not.toBeInTheDocument()
  })
  it('makes automatic sending explicit and distinguishes temporary uncertainty from a user hold', () => {
    useSpeakerTranscription.getState().setPendingQuestion({
      id: 'q',
      text: 'How does DNS work?',
      complete: true,
      manual: false,
      relation: 'new',
      reason: 'complete',
    })
    const { rerender } = render(<SpeakerPendingQuestion />)
    expect(screen.getByText('Sending new question…')).toBeInTheDocument()
    act(() =>
      useSpeakerTranscription.getState().setPendingQuestion({
        id: 'q',
        text: 'How does DNS work?',
        complete: false,
        manual: false,
        uncertain: true,
        reason: 'Could not understand the judge decision',
      })
    )
    rerender(<SpeakerPendingQuestion />)
    expect(screen.getByText('Waiting for clearer speech…')).toBeInTheDocument()
    expect(
      screen.getByText('Could not understand the judge decision')
    ).toBeInTheDocument()
    expect(screen.getByText('fn + ←')).toBeInTheDocument()
  })
  it('shows why a transcript requires manual sending', () => {
    useSpeakerTranscription
      .getState()
      .suggest('How does DNS work?', 'No judgement provider configured')
    render(<SpeakerSuggestions />)
    expect(
      screen.getByText('No judgement provider configured')
    ).toBeInTheDocument()
  })
  it('does not show recommendation cards alongside the question being built', () => {
    useSpeakerTranscription
      .getState()
      .suggest('What is DNS?', 'Earlier failure')
    useSpeakerTranscription.getState().setPendingQuestion({
      id: 'q',
      text: 'Suppose services fail.',
      complete: false,
      manual: false,
      reason: 'scenario',
    })
    render(
      <>
        <SpeakerPendingQuestion />
        <SpeakerSuggestions />
      </>
    )
    expect(screen.queryByText('New question?')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Speaker recommendations' })
    ).not.toBeInTheDocument()
  })
  it('expires review cards after three seconds without sending or losing a new scenario', () => {
    vi.useFakeTimers()
    useSpeakerTranscription.getState().setPendingQuestion({
      id: 'q',
      text: 'Suppose services fail.',
      complete: false,
      manual: false,
      relation: 'new',
      reason: 'scenario',
    })
    render(<SpeakerPendingQuestion />)
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.queryByText('New question?')).not.toBeInTheDocument()
    expect(sendNow).not.toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
    expect(useSpeakerTranscription.getState().pendingQuestion?.text).toBe(
      'Suppose services fail.'
    )
  })
  it('hides an unaccepted addition without sending or discarding it', () => {
    vi.useFakeTimers()
    useSpeakerTranscription.getState().setPendingQuestion({
      id: 'q',
      text: 'How does DNS work? With caching.',
      addition: 'With caching.',
      complete: false,
      manual: false,
      relation: 'update',
      reason: 'follow-up',
    })
    render(<SpeakerPendingQuestion />)
    expect(screen.getByText('Add to this question?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add/ })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(3000))
    expect(expireReview).toHaveBeenCalledWith(
      'q',
      'How does DNS work? With caching.'
    )
    expect(discard).not.toHaveBeenCalled()
    expect(sendNow).not.toHaveBeenCalled()
    expect(useSpeakerTranscription.getState().pendingQuestion?.addition).toBe(
      'With caching.'
    )
  })
  it('dismisses a new-question recommendation after three seconds', () => {
    vi.useFakeTimers()
    useSpeakerTranscription.getState().suggest('What is DNS?')
    render(<SpeakerSuggestions />)
    expect(screen.getByText('New question?')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(3000))
    expect(useSpeakerTranscription.getState().suggestions).toEqual([])
    expect(useSpeakerTranscription.getState().queue).toEqual([])
  })
  it('shows only the latest recommendation with distinct actions', () => {
    useSpeakerTranscription
      .getState()
      .suggest('Older question', 'Earlier failure')
    useSpeakerTranscription
      .getState()
      .suggest('What is your strong zone?', 'Provider response needs review')
    render(<SpeakerSuggestions />)
    expect(
      screen.getByRole('region', { name: 'Speaker recommendations' })
    ).toBeInTheDocument()
    expect(screen.getByText('What is your strong zone?')).toBeInTheDocument()
    expect(
      screen.getByText('Provider response needs review')
    ).toBeInTheDocument()
    const latest = within(
      screen.getByRole('article', { name: 'Latest speaker recommendation' })
    )
    expect(
      latest.getByRole('button', { name: /Send as new/ })
    ).toBeInTheDocument()
    expect(screen.getByText('fn + →')).toBeInTheDocument()
    expect(screen.queryByText('Older question')).not.toBeInTheDocument()
    fireEvent.click(
      latest.getByRole('button', { name: 'Discard recommendation' })
    )
    expect(useSpeakerTranscription.getState().suggestions).toEqual([])
  })
})
