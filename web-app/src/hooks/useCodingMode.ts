import { create } from 'zustand'

export const useCodingMode = create<{
  coding: boolean
  setCoding: (coding: boolean) => void
}>((set) => ({ coding: false, setCoding: (coding) => set({ coding }) }))
