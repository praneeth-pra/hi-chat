import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Stop a dictation by itself after 2 minutes of silence, so one left on
 * (a forgotten key, a laptop left recording) doesn't keep streaming to the
 * paid engines. On by default; the button in the chat header turns it off.
 */
type DictationAutoStopState = {
  on: boolean
  setOn: (on: boolean) => void
}

export const useDictationAutoStop = create<DictationAutoStopState>()(
  persist(
    (set) => ({
      on: true,
      setOn: (on) => set({ on }),
    }),
    {
      name: 'dictation-auto-stop',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
