import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ThinkingBlock, { thoughtFor } from '../ThinkingBlock'

describe('ThinkingBlock', () => {
  it('says how long it thought', () => {
    expect(thoughtFor(1.6)).toBe('Thought for 2s')
    expect(thoughtFor(0.3)).toBe('Thought for 1s')
    expect(thoughtFor(undefined)).toBeUndefined()
  })

  it('shows "Thought for Ns" when done, and opens the reasoning', () => {
    render(
      <ThinkingBlock
        id="t1"
        text="<think>Check the logs first. Then grep.</think>"
        seconds={2.2}
      />
    )
    const button = screen.getByRole('button', { name: /thought for 2s/i })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/Check the logs first/)).toBeTruthy()
  })
})
