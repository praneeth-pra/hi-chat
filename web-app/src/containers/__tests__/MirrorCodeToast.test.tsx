import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from 'sonner'
import { MirrorCodeToast, showMirrorCode } from '../MirrorCodeToast'

describe('the mirror link code in Hi-chat', () => {
  it('shows the code, how long it has left, and counts down', () => {
    vi.useFakeTimers()
    let t = 1_000_000
    render(
      <MirrorCodeToast
        code="4821"
        expiresAt={t + 5 * 60_000}
        onClose={() => {}}
        now={() => t}
      />
    )
    expect(screen.getByText('4821')).toBeTruthy()
    expect(screen.getByText('Expires in 5:00')).toBeTruthy()
    act(() => {
      t += 65_000
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('Expires in 3:55')).toBeTruthy()
    vi.useRealTimers()
  })

  it('closes from its button', async () => {
    const onClose = vi.fn()
    render(
      <MirrorCodeToast code="0042" expiresAt={Date.now() + 60_000} onClose={onClose} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Hide the code' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows as a toast, replaced by a new code, and goes when hidden', async () => {
    render(<Toaster />)
    act(() => showMirrorCode('1111', Date.now() + 60_000))
    expect(await screen.findByText('1111')).toBeTruthy()
    act(() => showMirrorCode('2222', Date.now() + 60_000))
    expect(await screen.findByText('2222')).toBeTruthy()
    expect(screen.queryByText('1111')).toBeNull()
    act(() => showMirrorCode(null))
    await vi.waitFor(() => expect(screen.queryByText('2222')).toBeNull())
  })
})
