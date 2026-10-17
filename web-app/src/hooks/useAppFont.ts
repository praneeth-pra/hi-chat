import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const FALLBACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"

/** Fonts offered in Settings > Interface; each is self-hosted except San Francisco */
export const APP_FONTS = [
  { id: 'onest', label: 'Onest', stack: `'Onest', ${FALLBACK}` },
  {
    id: 'sf',
    label: 'San Francisco',
    stack: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', ${FALLBACK}`,
  },
  { id: 'inter', label: 'Inter', stack: `'Inter', ${FALLBACK}` },
  { id: 'geist', label: 'Geist', stack: `'Geist', ${FALLBACK}` },
  { id: 'manrope', label: 'Manrope', stack: `'Manrope', ${FALLBACK}` },
  {
    id: 'ibm-plex-sans',
    label: 'IBM Plex Sans',
    stack: `'IBM Plex Sans', ${FALLBACK}`,
  },
  { id: 'figtree', label: 'Figtree', stack: `'Figtree', ${FALLBACK}` },
  {
    id: 'plus-jakarta-sans',
    label: 'Plus Jakarta Sans',
    stack: `'Plus Jakarta Sans', ${FALLBACK}`,
  },
] as const

export type AppFontId = (typeof APP_FONTS)[number]['id']

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
      font: 'onest',
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
