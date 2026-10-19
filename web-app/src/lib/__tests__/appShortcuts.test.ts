import { describe, it, expect, vi, beforeEach } from 'vitest'
import { appShortcuts, inHiChatApp, useAppShortcuts } from '../appShortcuts'

describe('appShortcuts', () => {
  beforeEach(() =>
    useAppShortcuts.setState({ actions: [], recording: null, answered: false })
  )

  it('does nothing in a browser', () => {
    const win = {} as Window
    expect(inHiChatApp(win)).toBe(false)
    expect(appShortcuts('list', undefined, win)).toBe(false)
  })

  it('asks the app and takes its answer', () => {
    const postMessage = vi.fn()
    const win = {
      chrome: { webview: { postMessage } },
    } as unknown as Window & {
      hiChatShortcuts?: (state: unknown) => void
    }
    expect(inHiChatApp(win)).toBe(true)
    appShortcuts('record', 'dictate', win)
    expect(postMessage).toHaveBeenCalledWith({
      shortcuts: 'record',
      id: 'dictate',
    })
    appShortcuts('reset', undefined, win)
    expect(postMessage).toHaveBeenLastCalledWith({ shortcuts: 'reset' })

    win.hiChatShortcuts?.({
      actions: [
        {
          id: 'dictate',
          label: 'Dictate',
          keys: ['Tap Left Ctrl'],
          isDefault: true,
          hold: false,
        },
      ],
      recording: 'dictate',
    })
    const state = useAppShortcuts.getState()
    expect(state.answered).toBe(true)
    expect(state.recording).toBe('dictate')
    expect(state.actions[0].keys).toEqual(['Tap Left Ctrl'])
  })
})
