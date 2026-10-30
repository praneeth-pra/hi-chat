import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'

// The shared screen layout on a laptop: the screen on the left, a divider
// you can drag, the conversation to its right. On an /m/ link the page opens
// on the code door first, so all of this appears only once let in.

const camera = vi.hoisted(() => ({ screen: null as unknown }))

vi.mock('@/hooks/useCameraSender', async (actual) => ({
  ...(await actual<typeof import('@/hooks/useCameraSender')>()),
  useCameraSender: () => ({
    screen: camera.screen,
    call: null,
    stream: null,
    status: null,
    devices: [],
    setFastScreen: () => {},
    setLightScreen: () => {},
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

// What the page watches for size changes
const watched = new Set<Element>()
const WIDTH = 1280
const realMatchMedia = window.matchMedia
const realWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'clientWidth'
)

beforeAll(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      els: Element[] = []
      observe(el: Element) {
        this.els.push(el)
        watched.add(el)
      }
      disconnect() {
        for (const el of this.els) watched.delete(el)
      }
      unobserve() {}
    }
  )
  // A laptop: side by side, 1280 px wide
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => WIDTH,
  })
  HTMLMediaElement.prototype.play = () => Promise.resolve()
})

afterAll(() => {
  window.matchMedia = realMatchMedia
  if (realWidth)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', realWidth)
})

beforeEach(() => {
  FakeSocket.all = []
  watched.clear()
  localStorage.clear()
  camera.screen = { getVideoTracks: () => [], getAudioTracks: () => [] }
})

const connect = () =>
  act(() => {
    last().readyState = 1
    last().onopen?.()
  })
const letIn = async () => {
  render(<MirrorViewer link="abcdefghijklmnopqrstuv" />)
  connect()
  hear({ t: 'gate' })
  hear({ t: 'sender', on: true })
  hear({ t: 'admitted', ticket: 'T'.repeat(24) })
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull()
  )
}
const divider = () =>
  screen.queryByRole('separator', { name: 'Resize the shared screen' })
const box = () =>
  screen.getByLabelText("Hi-chat's message box").parentElement!.parentElement!
const sharedScreen = () =>
  screen.getByRole('region', { name: 'Shared screen' }) as HTMLElement

/** The text starts right of the shared screen, never under it. */
const clearOfScreen = () => {
  const screenWidth = parseFloat(sharedScreen().style.width)
  expect(screenWidth).toBeGreaterThan(0)
  expect(parseFloat(box().style.marginLeft)).toBeGreaterThan(screenWidth)
  expect(parseFloat(divider()!.style.left)).toBe(screenWidth)
}

describe('mirror on a laptop while Meet presents', () => {
  it('after the code door: the divider shows and the text clears the screen', async () => {
    await letIn()
    expect(divider()).toBeTruthy()
    clearOfScreen()
  })

  it('without a code door (the page opened in Hi-chat itself)', () => {
    render(<MirrorViewer />)
    connect()
    expect(divider()).toBeTruthy()
    clearOfScreen()
  })

  it('still lays out after the door shuts and opens again', async () => {
    await letIn()
    hear({ t: 'gate' })
    expect(screen.getByRole('button', { name: 'Get a code' })).toBeTruthy()
    expect(divider()).toBeNull()
    hear({ t: 'admitted', ticket: 'U'.repeat(24) })
    await waitFor(() => expect(divider()).toBeTruthy())
    clearOfScreen()
  })

  it('watches the page and the conversation once they appear', async () => {
    await letIn()
    // The page's width (for the divider) and the conversation's height (to
    // follow a growing answer)
    expect(watched.size).toBeGreaterThanOrEqual(2)
    for (const el of watched) expect(el.isConnected).toBe(true)
  })

  it('the remembered split is used after the code door', async () => {
    localStorage.setItem('hichat-mirror-split', '0.4')
    await letIn()
    expect(parseFloat(sharedScreen().style.width)).toBe(0.4 * WIDTH)
    clearOfScreen()
  })

  it('with nothing presented: no divider, no screen', async () => {
    camera.screen = null
    await letIn()
    expect(divider()).toBeNull()
    expect(screen.queryByRole('region', { name: 'Shared screen' })).toBeNull()
  })
})
