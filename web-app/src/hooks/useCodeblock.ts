import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export type CodeBlockStyle = string

interface CodeBlockState {
  codeBlockStyle: CodeBlockStyle
  showLineNumbers: boolean
  setCodeBlockStyle: (style: CodeBlockStyle) => void
  setShowLineNumbers: (show: boolean) => void
  resetCodeBlockStyle: () => void
}

const defaultCodeBlockStyle: CodeBlockStyle = 'vsc-dark-plus'
const defaultShowLineNumbers: boolean = false

export const useCodeblock = create<CodeBlockState>()(
  persist(
    (set) => {
      return {
        codeBlockStyle: defaultCodeBlockStyle,
        showLineNumbers: defaultShowLineNumbers,

        setCodeBlockStyle: (style: CodeBlockStyle) => {
          set({ codeBlockStyle: style })
        },

        setShowLineNumbers: (show: boolean) => {
          set({ showLineNumbers: show })
        },

        resetCodeBlockStyle: () => {
          set({
            codeBlockStyle: defaultCodeBlockStyle,
            showLineNumbers: defaultShowLineNumbers,
          })
        },
      }
    },
    {
      name: localStorageKey.settingCodeBlock,
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // v1: line numbers off for everyone, including saved settings
      migrate: (persisted) => ({
        ...(persisted as CodeBlockState),
        showLineNumbers: false,
      }),
    }
  )
)
