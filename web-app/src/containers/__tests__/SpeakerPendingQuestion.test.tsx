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
  discard = vi.fn()
let unregister: () => void
beforeEach(() => {
  vi.clearAllMocks()
  useSpeakerTranscription.getState().resetTurns()
  useSpeakerTranscription.getState().setEnabled(true)
  unregister = setQuestionControls({ sendNow, keepListening, discard })
})
afterEach(() => unregister())
describe('pending question controls', () => {
  it('previews scenario text and exposes all three controls', () => {
    useSpeakerTranscription.getState().setPendingQuestion({
      id: 'q',
      text: 'Suppose three services fail.',
      complete: false,
      manual: false,
      reason: 'scenario',
    })
    render(<SpeakerPendingQuestion />)
    expect(screen.getByText('Building question…')).toBeInTheDocument()
    expect(screen.getByText('Suppose three services fail.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    expect(sendNow).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Keep listening' }))
    expect(keepListening).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(discard).toHaveBeenCalledTimes(1)
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
    expect(
      screen.getByRole('button', { name: 'Keep listening' })
    ).toBeDisabled()
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
      reason: 'complete',
    })
    const { rerender } = render(<SpeakerPendingQuestion />)
    expect(screen.getByText('Sending automatically…')).toBeInTheDocument()
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
    expect(
      screen.getByRole('button', { name: 'Keep listening' })
    ).not.toBeDisabled()
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
  it('shows a readable latest recommendation with distinct actions and collapses earlier ones', () => {
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
    expect(screen.getByText('1 earlier recommendation')).toBeInTheDocument()
    fireEvent.click(
      latest.getByRole('button', { name: 'Discard recommendation' })
    )
    expect(useSpeakerTranscription.getState().suggestions).toEqual([
      'Older question',
    ])
  })
})
