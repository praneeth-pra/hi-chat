import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DictationToggleButton } from '../DictationToggleButton'
import { useDictationEnabled } from '@/hooks/useDictationEnabled'

describe('DictationToggleButton', () => {
  it('is on by default and turns dictation off and on', () => {
    render(<DictationToggleButton />)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    expect(useDictationEnabled.getState().on).toBe(false)
    fireEvent.click(button)
    expect(useDictationEnabled.getState().on).toBe(true)
  })
})
