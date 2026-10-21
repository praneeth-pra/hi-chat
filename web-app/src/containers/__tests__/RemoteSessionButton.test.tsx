import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RemoteSessionButton } from '../RemoteSessionButton'
import { useRemoteSession } from '@/hooks/useRemoteSession'

describe('remote session button', () => {
  it('is off by default and turns the remote session on and off', async () => {
    const user = userEvent.setup()
    render(<RemoteSessionButton />)
    const button = screen.getByRole('button', { name: /Remote session off/ })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(useRemoteSession.getState().on).toBe(false)
    await user.click(button)
    expect(useRemoteSession.getState().on).toBe(true)
    expect(
      screen
        .getByRole('button', { name: /Remote session on/ })
        .getAttribute('aria-pressed')
    ).toBe('true')
    await user.click(screen.getByRole('button', { name: /Remote session on/ }))
    expect(useRemoteSession.getState().on).toBe(false)
  })
})
