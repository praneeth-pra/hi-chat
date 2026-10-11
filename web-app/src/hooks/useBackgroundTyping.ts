import { create } from 'zustand'

// Hammerspoon renews this while routing is enabled. A stopped/reloaded script
// must not leave the browser displaying a stale enabled indicator.
const HEARTBEAT_TIMEOUT_MS = 6000
let expiry: ReturnType<typeof setTimeout> | undefined

export const useBackgroundTyping = create<{
  enabled: boolean
  heartbeat: () => void
  disable: () => void
}>((set) => ({
  enabled: false,
  heartbeat: () => {
    clearTimeout(expiry)
    set({ enabled: true })
    expiry = setTimeout(() => set({ enabled: false }), HEARTBEAT_TIMEOUT_MS)
  },
  disable: () => {
    clearTimeout(expiry)
    expiry = undefined
    set({ enabled: false })
  },
}))
