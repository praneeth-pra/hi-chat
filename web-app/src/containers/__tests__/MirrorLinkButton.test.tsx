import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { endsIn, onMirrorLinkRenewed } from '@/lib/mirrorLink'
import { MirrorLinkButton } from '../MirrorLinkButton'

beforeEach(() => localStorage.clear())

const opened = async () => {
  const user = userEvent.setup()
  render(<MirrorLinkButton />)
  await user.click(
    screen.getByRole('button', { name: "Copy this app's mirror link" })
  )
  return user
}

describe('mirror link button', () => {
  it('copies the link and says when it ends', async () => {
    await opened()
    const box = screen.getByRole('textbox', {
      name: 'Mirror link',
    }) as HTMLInputElement
    expect(box.value).toMatch(/\/m\/[A-Za-z0-9_-]{24}$/)
    // userEvent stands in a clipboard of its own
    expect(await navigator.clipboard.readText()).toBe(box.value)
    expect(screen.getByText(/Ends in (89|90) min/)).toBeTruthy()
  })

  it('revokes the link after a confirm, cutting off whoever has it', async () => {
    const user = await opened()
    const box = screen.getByRole('textbox', {
      name: 'Mirror link',
    }) as HTMLInputElement
    const shared = box.value.split('/m/')[1]
    const ended: string[] = []
    const off = onMirrorLinkRenewed((old) => ended.push(old))

    await user.click(screen.getByRole('button', { name: /Revoke link/ }))
    expect(ended).toEqual([]) // not before confirming
    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    off()
    expect(ended).toEqual([shared])
    expect(screen.getByRole('status').textContent).toMatch(/Link revoked/)
    expect(screen.queryByRole('textbox', { name: 'Mirror link' })).toBeNull()

    // A new link only when asked for, and it's a different one
    await user.click(screen.getByRole('button', { name: 'Copy a new link' }))
    const next = (
      screen.getByRole('textbox', { name: 'Mirror link' }) as HTMLInputElement
    ).value
    expect(next).not.toContain(shared)
  })

  it('reads the time left in whole minutes', () => {
    expect(endsIn(90 * 60_000)).toBe('Ends in 90 min')
    expect(endsIn(61_000)).toBe('Ends in 1 min')
    expect(endsIn(59_000)).toBe('Ends in under a minute')
  })

  it('shows the link ended once its 90 minutes are up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await opened()
      expect(screen.getByRole('textbox', { name: 'Mirror link' })).toBeTruthy()
      act(() => {
        vi.advanceTimersByTime(90 * 60_000 + 5_000)
      })
      expect(screen.getByRole('status').textContent).toMatch(
        /90 minutes are up/
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('camera extension download, in Hi-chat', () => {
  it('fetches the key and saves the zip', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === '/api/camera-key'
        ? new Response(JSON.stringify({ key: 'k1' }))
        : new Response(`// ${url}`)
    )
    vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    try {
      const user = await opened()
      await user.click(
        screen.getByRole('button', { name: /Download the camera extension/ })
      )
      expect(fetchMock).toHaveBeenCalledWith('/api/camera-key', {
        method: 'POST',
      })
      expect(fetchMock).toHaveBeenCalledWith('/hichat-extension/page.js')
      expect(click).toHaveBeenCalled()
      expect(screen.queryByRole('alert')).toBeNull()
    } finally {
      click.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('says so when it fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 }))
    )
    try {
      const user = await opened()
      await user.click(
        screen.getByRole('button', { name: /Download the camera extension/ })
      )
      expect(screen.getByRole('alert').textContent).toMatch(/Couldn't/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
