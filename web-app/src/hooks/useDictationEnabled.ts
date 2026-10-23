import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Dictation on or off on this device (the microphone button in the chat
 * header). Off, dictation can't start (shortcuts, the button, /mirror's
 * keys) and the mic is let go, so a laptop that shouldn't dictate can't
 * stream to the paid engines. On by default.
 */
type DictationEnabledState = {
  on: boolean
  setOn: (on: boolean) => void
}

export const useDictationEnabled = create<DictationEnabledState>()(
  persist(
    (set) => ({
      on: true,
      setOn: (on) => set({ on }),
    }),
    {
      name: 'dictation-enabled',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
