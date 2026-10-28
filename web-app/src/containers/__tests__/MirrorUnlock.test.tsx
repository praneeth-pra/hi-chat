import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UnlockState } from '@/lib/mirrorDirect'

// The direct channel, driven by the test: what Hi-chat says about unlocking
const direct = vi.hoisted(() => ({
  onUnlock: (_s: UnlockState) => {},
  onControl: (_c: boolean) => {},
  askForCode: vi.fn(() => true),
  sendCode: vi.fn((_c: string) => true),
}))

vi.mock('@/lib/mirrorDirect', async (actual) => ({
  ...(await actual<typeof import('@/lib/mirrorDirect')>()),
  createDirectViewer: (o: {
    onUnlock: (s: UnlockState) => void
    onControl: (c: boolean) => void
  }) => {
    direct.onUnlock = o.onUnlock
    direct.onControl = o.onControl
    return {
      receive() {},
      ping: () => false,
      open: 0,
      sendInput: () => false,
      askForCode: direct.askForCode,
      sendCode: direct.sendCode,
      closeAll() {},
    }
  },
}))

// A screen being presented from the call
vi.mock('@/hooks/useCameraSender', async (actual) => ({
  ...(await actual<typeof import('@/hooks/useCameraSender')>()),
  useCameraSender: () => ({
    screen: { getVideoTracks: () => [] },
    call: null,
    stream: null,
    status: null,
    devices: [],
    setFastScreen: () => {},
    screenStats: async () => null,
  }),
}))
vi.mock('@/containers/RemoteCameraPanel', async (actual) => ({
  ...(await actual<typeof import('@/containers/RemoteCameraPanel')>()),
  RemoteCameraPanel: () => null,
}))

import { MirrorViewer } from '../MirrorView'

class FakeSocket {
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: (() => void) | null = null
  onclose: (() => void) | null = null
  send() {}
  close() {}
}

beforeAll(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  )
  HTMLMediaElement.prototype.play = () => Promise.resolve()
})

beforeEach(() => {
  direct.askForCode.mockClear()
  direct.sendCode.mockClear()
})

const lockedLink = () => {
  render(<MirrorViewer link="abcdefghijklmnop" />)
  act(() => direct.onUnlock({ can: true }))
}

describe('/m/ link: unlocking control with a code', () => {
  it('shows Unlock (not Edit) while locked, and nothing when it cannot', () => {
    render(<MirrorViewer link="abcdefghijklmnop" />)
    expect(screen.queryByRole('button', { name: /Unlock/ })).toBeNull()
    act(() => direct.onUnlock({ can: true }))
    expect(screen.getByRole('button', { name: /Unlock to edit/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
  })

  it('asks Hi-chat for a code and opens an empty code box', async () => {
    const user = userEvent.setup()
    lockedLink()
    await user.click(screen.getByRole('button', { name: /Unlock to edit/ }))
    expect(direct.askForCode).toHaveBeenCalledTimes(1)
    const box = screen.getByRole('textbox', {
      name: 'Code',
    }) as HTMLInputElement
    expect(box.value).toBe('')
    expect(box.placeholder).toBe('')
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled()
  })

  it('takes digits only, at most 4, and sends them', async () => {
    const user = userEvent.setup()
    lockedLink()
    await user.click(screen.getByRole('button', { name: /Unlock to edit/ }))
    const box = screen.getByRole('textbox', {
      name: 'Code',
    }) as HTMLInputElement
    await user.type(box, '4a8 2193')
    expect(box.value).toBe('4821')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(direct.sendCode).toHaveBeenCalledWith('4821')
  })

  it('says how many tries are left after a wrong code, and empties the box', async () => {
    const user = userEvent.setup()
    lockedLink()
    await user.click(screen.getByRole('button', { name: /Unlock to edit/ }))
    const box = screen.getByRole('textbox', {
      name: 'Code',
    }) as HTMLInputElement
    await user.type(box, '1111{Enter}')
    expect(direct.sendCode).toHaveBeenCalledWith('1111')
    act(() => direct.onUnlock({ can: true, left: 4 }))
    expect(screen.getByRole('alert').textContent).toMatch(
      /Wrong code\. 4 tries left/
    )
    expect(box.value).toBe('')
    act(() => direct.onUnlock({ can: true, left: 1 }))
    expect(screen.getByRole('alert').textContent).toMatch(/1 try left/)
  })

  it('a used-up code says to reload, with no box to type in', async () => {
    const user = userEvent.setup()
    lockedLink()
    await user.click(screen.getByRole('button', { name: /Unlock to edit/ }))
    act(() => direct.onUnlock({ can: true, left: 0, spent: true }))
    expect(screen.getByRole('alert').textContent).toMatch(
      /no longer works\. Reload this page/
    )
    expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull()
  })

  it('the right code turns editing on and the box goes', async () => {
    const user = userEvent.setup()
    lockedLink()
    await user.click(screen.getByRole('button', { name: /Unlock to edit/ }))
    await user.type(
      screen.getByRole('textbox', { name: 'Code' }),
      '4821{Enter}'
    )
    act(() => {
      direct.onControl(true)
      direct.onUnlock({ can: false })
    })
    expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Unlock/ })).toBeNull()
    const edit = screen.getByRole('button', { name: /Editing/ })
    expect(edit.getAttribute('aria-pressed')).toBe('true')
  })
})
