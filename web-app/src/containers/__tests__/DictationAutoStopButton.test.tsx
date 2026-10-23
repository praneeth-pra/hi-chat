import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictationAutoStopButton } from '../DictationAutoStopButton'
import { useDictationAutoStop } from '@/hooks/useDictationAutoStop'

describe('DictationAutoStopButton', () => {
  it('is on by default and toggles', () => {
    render(<DictationAutoStopButton />)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    expect(useDictationAutoStop.getState().on).toBe(false)
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })
})
