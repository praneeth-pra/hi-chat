import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// What the page passes the camera: the ticket, once let in
const camera = vi.hoisted(() => ({ ticket: undefined as string | undefined }))

vi.mock('@/hooks/useCameraSender', async (actual) => ({
  ...(await actual<typeof import('@/hooks/useCameraSender')>()),
  useCameraSender: ({ ticket }: { ticket?: string }) => {
    camera.ticket = ticket
    return {
      screen: null,
      call: null,
      stream: null,
      status: null,
      devices: [],
      setFastScreen: () => {},
      setLightScreen: () => {},
      screenStats: async () => null,
    }
  },
}))
vi.mock('@/containers/RemoteCameraPanel', async (actual) => ({
  ...(await actual<typeof import('@/containers/RemoteCameraPanel')>()),
  RemoteCameraPanel: () => null,
}))

import { MirrorViewer } from '../MirrorView'

class FakeSocket {
  static OPEN = 1
  static all: FakeSocket[] = []
  readyState = 0
  sent: Record<string, unknown>[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {}
}
const last = () => FakeSocket.all.at(-1)!
const hear = (m: unknown) =>
  act(() => last().onmessage?.({ data: JSON.stringify(m) }))

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
  FakeSocket.all = []
  camera.ticket = undefined
})

const atDoor = () => {
  render(<MirrorViewer link="abcdefghijklmnopqrstuv" />)
  act(() => {
    last().readyState = 1
    last().onopen?.()
  })
  hear({ t: 'gate' })
  hear({ t: 'sender', on: true })
}
const asked = async () => {
  const user = userEvent.setup()
  atDoor()
  // Once Hi-chat is known to be on (applied on the next frame)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Get a code' })).toBeEnabled()
  )
  await user.click(screen.getByRole('button', { name: 'Get a code' }))
  return user
}

describe('/m/ link: a code before anything shows', () => {
  it('shows only the door, and asks Hi-chat for a code', async () => {
    await asked()
    expect(last().sent).toContainEqual({ t: 'unlock' })
    const box = screen.getByRole('textbox', {
      name: 'Code',
    }) as HTMLInputElement
    expect(box.value).toBe('')
    expect(box.placeholder).toBe('')
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled()
    expect(camera.ticket).toBeUndefined()
  })

  it('takes digits only, at most 4, and sends them', async () => {
    const user = await asked()
    const box = screen.getByRole('textbox', {
      name: 'Code',
    }) as HTMLInputElement
    await user.type(box, '4a8 2193')
    expect(box.value).toBe('4821')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(last().sent).toContainEqual({ t: 'code', code: '4821' })
  })

  it('says how many tries are left, and empties the box', async () => {
    const user = await asked()
    const box = screen.getByRole('textbox', {
      name: 'Code',
    }) as HTMLInputElement
    await user.type(box, '1111{Enter}')
    hear({ t: 'code', ok: false, left: 4 })
    expect(screen.getByRole('alert').textContent).toMatch(/4 tries left/)
    expect(box.value).toBe('')
    hear({ t: 'code', ok: false, left: 1 })
    expect(screen.getByRole('alert').textContent).toMatch(/1 try left/)
  })

  it('a run-out code offers a new one; too many wrong ones say reload', async () => {
    await asked()
    hear({ t: 'code', ok: false, left: 0 })
    expect(screen.getByRole('alert').textContent).toMatch(/run out/)
    expect(screen.getByRole('button', { name: 'Get a new code' })).toBeTruthy()
    hear({ t: 'code', ok: false, left: 0, spent: true })
    expect(screen.getByRole('alert').textContent).toMatch(/Reload this page/)
    expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull()
    expect(screen.queryByRole('button', { name: /code/ })).toBeNull()
  })

  it('a link locked by too many wrong codes says to make a new link', async () => {
    await asked()
    hear({ t: 'code', ok: false, left: 0, spent: true, locked: true })
    expect(screen.getByRole('alert').textContent).toMatch(
      /Copy a new link from Hi-chat/
    )
    expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull()
    expect(screen.queryByRole('button', { name: /code/ })).toBeNull()
  })

  it('says when Hi-chat is not open to show a code', async () => {
    atDoor()
    hear({ t: 'sender', on: false })
    expect(await screen.findByText(/isn't open/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Get a code' })).toBeDisabled()
  })

  it('the right code opens the mirror, and its ticket comes back', async () => {
    await asked()
    hear({ t: 'admitted', ticket: 'T'.repeat(24) })
    expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull()
    expect(screen.queryByText('Enter the code')).toBeNull()
    // The camera may send now
    expect(camera.ticket).toBe('T'.repeat(24))
    // A dropped connection comes back with the ticket, not a new code
    act(() => last().onclose?.({ code: 1006 }))
    await act(() => new Promise((r) => setTimeout(r, 1100)))
    expect(last().url).toMatch(/&ticket=T{24}$/)
  })
})
