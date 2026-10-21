import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * The remote session: while on, this app sends its conversation to /mirror
 * (and /mirror can edit the shared screen). Off by default, and while off
 * the mirror doesn't run at all, so it costs Hi-chat nothing.
 */
type RemoteSessionState = {
  on: boolean
  setOn: (on: boolean) => void
}

export const useRemoteSession = create<RemoteSessionState>()(
  persist(
    (set) => ({
      on: false,
      setOn: (on) => set({ on }),
    }),
    {
      name: 'remote-session',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
