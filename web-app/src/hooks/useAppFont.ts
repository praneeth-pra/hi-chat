import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const FALLBACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"

/**
 * Fonts offered in Settings > Interface, the most readable for answers on a
 * dark screen; each is self-hosted except San Francisco (Apple's own, Segoe
 * UI on Windows). Figtree is the default.
 */
export const APP_FONTS = [
  { id: 'figtree', label: 'Figtree', stack: `'Figtree', ${FALLBACK}` },
  { id: 'inter', label: 'Inter', stack: `'Inter', ${FALLBACK}` },
  {
    id: 'sf',
    label: 'San Francisco',
    stack: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', ${FALLBACK}`,
  },
  { id: 'geist', label: 'Geist', stack: `'Geist', ${FALLBACK}` },
  {
    id: 'public-sans',
    label: 'Public Sans',
    stack: `'Public Sans', ${FALLBACK}`,
  },
] as const

export type AppFontId = (typeof APP_FONTS)[number]['id']

/** A font that was removed (Literata and the like) falls back to the default. */
export const appFontStack = (id: string) =>
  (APP_FONTS.find((f) => f.id === id) ?? APP_FONTS[0]).stack

const apply = (id: string) => {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--app-font', appFontStack(id))
}

type AppFontState = {
  font: AppFontId
  setFont: (font: AppFontId) => void
}

export const useAppFont = create<AppFontState>()(
  persist(
    (set) => ({
      font: 'figtree',
      setFont: (font) => {
        apply(font)
        set({ font })
      },
    }),
    {
      name: 'app-font',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) apply(state.font)
      },
    }
  )
)
