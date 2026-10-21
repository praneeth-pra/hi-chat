// Remote control: /mirror's mouse and keys over the shared screen, as actions
// the Hi-chat Mac app replays on the computer being shared (mac-app,
// RemoteInput). They travel on the direct channel's own "input" lane
// (lib/mirrorDirect.ts).
//
// Actions (all small JSON):
//   m   pointer moved to x, y (0 to 1 across the shared screen)
//   d/u button `b` (0 left, 1 right, 2 middle) down/up at x, y; `c` clicks
//   w   wheel by dx, dy pixels
//   kd/ku key down/up: `c` the Mac key code, `r` a repeat
//   r   release everything held (editing stopped, window left)
// Each carries `m`, the modifiers held (MOD bits), and mouse actions `a`, the
// shared picture's width / height, so the app knows which display it is.

import type { RemoteInput } from '@/lib/mirrorDirect'

export const MOD = { cmd: 1, shift: 2, option: 4, control: 8 } as const

/** Mac virtual key codes, by KeyboardEvent.code (a US layout's positions). */
export const MAC_KEYS: Record<string, number> = {
  KeyA: 0,
  KeyS: 1,
  KeyD: 2,
  KeyF: 3,
  KeyH: 4,
  KeyG: 5,
  KeyZ: 6,
  KeyX: 7,
  KeyC: 8,
  KeyV: 9,
  IntlBackslash: 10,
  KeyB: 11,
  KeyQ: 12,
  KeyW: 13,
  KeyE: 14,
  KeyR: 15,
  KeyY: 16,
  KeyT: 17,
  Digit1: 18,
  Digit2: 19,
  Digit3: 20,
  Digit4: 21,
  Digit6: 22,
  Digit5: 23,
  Equal: 24,
  Digit9: 25,
  Digit7: 26,
  Minus: 27,
  Digit8: 28,
  Digit0: 29,
  BracketRight: 30,
  KeyO: 31,
  KeyU: 32,
  BracketLeft: 33,
  KeyI: 34,
  KeyP: 35,
  Enter: 36,
  KeyL: 37,
  KeyJ: 38,
  Quote: 39,
  KeyK: 40,
  Semicolon: 41,
  Backslash: 42,
  Comma: 43,
  Slash: 44,
  KeyN: 45,
  KeyM: 46,
  Period: 47,
  Tab: 48,
  Space: 49,
  Backquote: 50,
  Backspace: 51,
  Escape: 53,
  CapsLock: 57,
  NumpadDecimal: 65,
  NumpadMultiply: 67,
  NumpadAdd: 69,
  NumLock: 71,
  NumpadDivide: 75,
  NumpadEnter: 76,
  NumpadSubtract: 78,
  NumpadEqual: 81,
  Numpad0: 82,
  Numpad1: 83,
  Numpad2: 84,
  Numpad3: 85,
  Numpad4: 86,
  Numpad5: 87,
  Numpad6: 88,
  Numpad7: 89,
  Numpad8: 91,
  Numpad9: 92,
  F5: 96,
  F6: 97,
  F7: 98,
  F3: 99,
  F8: 100,
  F9: 101,
  F11: 103,
  F10: 109,
  F12: 111,
  Insert: 114,
  Home: 115,
  PageUp: 116,
  Delete: 117,
  F4: 118,
  End: 119,
  F2: 120,
  PageDown: 121,
  F1: 122,
  ArrowLeft: 123,
  ArrowRight: 124,
  ArrowDown: 125,
  ArrowUp: 126,
  ContextMenu: 110,
}

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'Fn',
])

type Mods = Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>

/**
 * The Mac modifiers for what is held here. From a Windows or Linux
 * keyboard, Ctrl acts as Command (Ctrl+C copies on the Mac) and the Windows
 * key as Control.
 */
export function macMods(e: Mods, viewerIsMac: boolean): number {
  let m = 0
  if (e.shiftKey) m |= MOD.shift
  if (e.altKey) m |= MOD.option
  if (viewerIsMac) {
    if (e.metaKey) m |= MOD.cmd
    if (e.ctrlKey) m |= MOD.control
  } else {
    if (e.ctrlKey) m |= MOD.cmd
    if (e.metaKey) m |= MOD.control
  }
  return m
}

/** A key press or release as an action, or null for keys not replayed. */
export function keyAction(
  e: Mods & Pick<KeyboardEvent, 'code' | 'repeat'>,
  down: boolean,
  viewerIsMac: boolean
): RemoteInput | null {
  // Modifiers travel with each key and click instead
  if (MODIFIER_CODES.has(e.code)) return null
  const c = MAC_KEYS[e.code]
  if (c === undefined) return null
  const m = macMods(e, viewerIsMac)
  return down
    ? { k: 'kd', c, m, ...(e.repeat ? { r: 1 } : {}) }
    : { k: 'ku', c, m }
}

/**
 * Where a point on the page falls on the shared screen, 0 to 1 each way,
 * given the video element's box and its picture's size (the picture is
 * fitted inside the box, with bars either side). Null outside the picture.
 */
export function screenPoint(
  clientX: number,
  clientY: number,
  box: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  videoWidth: number,
  videoHeight: number
): { x: number; y: number } | null {
  if (!videoWidth || !videoHeight || !box.width || !box.height) return null
  const scale = Math.min(box.width / videoWidth, box.height / videoHeight)
  const w = videoWidth * scale
  const h = videoHeight * scale
  const left = box.left + (box.width - w) / 2
  const top = box.top + (box.height - h) / 2
  const x = (clientX - left) / w
  const y = (clientY - top) / h
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 }
}

/** A wheel turn in pixels, whatever unit the browser reported it in. */
export function wheelPixels(
  e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>,
  pageHeight = 800
) {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageHeight : 1
  return {
    dx: Math.round(e.deltaX * unit),
    dy: Math.round(e.deltaY * unit),
  }
}

/** Counts quick clicks in one place (a double click is two). */
export function createClickCounter(now: () => number = () => Date.now()) {
  let last = { t: -Infinity, x: 0, y: 0, b: -1, n: 0 }
  return (b: number, x: number, y: number) => {
    const t = now()
    const near = Math.abs(x - last.x) < 0.01 && Math.abs(y - last.y) < 0.01
    const n = b === last.b && near && t - last.t < 450 ? last.n + 1 : 1
    last = { t, x, y, b, n }
    return Math.min(n, 3)
  }
}
