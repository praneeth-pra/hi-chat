import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const FALLBACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"

/** Fonts offered in Settings > Interface; each is self-hosted except San Francisco */
export const APP_FONTS = [
  {
    id: 'literata',
    label: 'Literata',
    stack: `'Literata', Georgia, 'Times New Roman', serif`,
  },
  {
    id: 'atkinson-hyperlegible-next',
    label: 'Atkinson Hyperlegible Next',
    stack: `'Atkinson Hyperlegible Next', ${FALLBACK}`,
  },
  {
    id: 'merriweather',
    label: 'Merriweather',
    stack: `'Merriweather', Georgia, 'Times New Roman', serif`,
  },
  { id: 'lexend', label: 'Lexend', stack: `'Lexend', ${FALLBACK}` },
  {
    id: 'sf',
    label: 'San Francisco',
    stack: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', ${FALLBACK}`,
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
      font: 'literata',
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
