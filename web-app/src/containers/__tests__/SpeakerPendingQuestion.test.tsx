import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setQuestionControls,
  useSpeakerTranscription,
} from '@/hooks/useSpeakerTranscription'
import { SpeakerPendingQuestion } from '../SpeakerListenIndicator'
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
    useSpeakerTranscription
      .getState()
      .setPendingQuestion({
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
    useSpeakerTranscription
      .getState()
      .setPendingQuestion({
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
})
