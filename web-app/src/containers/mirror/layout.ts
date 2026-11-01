import { useEffect, useLayoutEffect, useState } from 'react'
import type { MirrorState } from '@/lib/remoteMirror'

// How the mirror page is laid out: the shared screen, the text column and
// the camera panel side by side on a laptop, and Hi-chat's own look.

export const SPLIT = 'hichat-mirror-split' // the screen's share of the width
export const TEXT_WIDTH = 448 // the reading column, like Hi-chat's own window
export const MIN_TEXT = 300
export const PANEL_WIDTH = 360
export const GAP = 24
const MIN_SCREEN = 200

/** The screen's width, leaving room for the text and the camera panel. */
export function clampScreen(px: number, total: number, right: number) {
  const max = total - right - MIN_TEXT - GAP * 2
  return Math.max(MIN_SCREEN, Math.min(px, Math.max(MIN_SCREEN, max)))
}

/** Whether the page is laid out side by side (Tailwind's lg). */
export function useWide() {
  const query = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const list = matchMedia(query)
    const on = () => setWide(list.matches)
    list.addEventListener('change', on)
    return () => list.removeEventListener('change', on)
  }, [])
  return wide
}

/**
 * While Hi-chat says how it looks, this page looks the same: its colours,
 * font and font size (its CSS variables), and dark or light. Put back as it
 * was on leaving.
 */
export function useLook(look: MirrorState['look']) {
  useLayoutEffect(() => {
    if (!look) return
    const root = document.documentElement
    const before = Object.keys(look.vars).map(
      (k) => [k, root.style.getPropertyValue(k)] as const
    )
    const wasDark = root.classList.contains('dark')
    for (const [k, v] of Object.entries(look.vars)) root.style.setProperty(k, v)
    root.classList.toggle('dark', look.dark)
    return () => {
      for (const [k, v] of before)
        if (v) root.style.setProperty(k, v)
        else root.style.removeProperty(k)
      root.classList.toggle('dark', wasDark)
    }
  }, [look])
}
