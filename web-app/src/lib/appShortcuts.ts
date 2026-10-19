import { create } from 'zustand'

/** One action of the Mac or Windows app's global keys, as the app reports it. */
export type AppShortcutAction = {
  id: string
  label: string
  /** Each way to press it, as it reads ("Tap Left Control", "fn N") */
  keys: string[]
  isDefault: boolean
  /** Held while scrolling, rather than pressed */
  hold: boolean
}

export type AppShortcutsState = {
  actions: AppShortcutAction[]
  /** The action waiting for its new keys */
  recording: string | null
  /** Why keys can't be recorded right now */
  unavailable?: string
}

/**
 * Settings > App keys. answered: the app has replied; an app from before
 * this setting never does.
 */
export const useAppShortcuts = create<
  AppShortcutsState & { answered: boolean }
>(() => ({ actions: [], recording: null, answered: false }))

type Bridge = { postMessage: (message: unknown) => void }
type AppWindow = Window & {
  hiChatShortcuts?: (state: AppShortcutsState) => void
  webkit?: { messageHandlers?: { hiChat?: Bridge } }
  chrome?: { webview?: Bridge }
}

const bridge = (win: AppWindow) =>
  win.webkit?.messageHandlers?.hiChat ?? win.chrome?.webview

/** Inside the Mac or Windows app, rather than a browser. */
export const inHiChatApp = (win: AppWindow = window) => !!bridge(win)

export type AppShortcutCommand =
  | 'list'
  | 'record'
  | 'cancel'
  | 'clear'
  | 'reset'

/**
 * Asks the app to list its keys, record new ones for an action (the next
 * keys pressed anywhere), cancel that, clear an action, or reset one (or
 * all, with no id). The app answers through window.hiChatShortcuts.
 */
export function appShortcuts(
  command: AppShortcutCommand,
  id?: string,
  win: AppWindow = window
): boolean {
  const app = bridge(win)
  if (!app) return false
  win.hiChatShortcuts ??= (state) =>
    useAppShortcuts.setState({
      actions: state.actions ?? [],
      recording: state.recording ?? null,
      unavailable: state.unavailable,
      answered: true,
    })
  app.postMessage(id ? { shortcuts: command, id } : { shortcuts: command })
  return true
}
