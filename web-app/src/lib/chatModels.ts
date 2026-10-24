import type { AutoMode } from './autoRace'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Model labels and the Groq/Cerebras participants in the two Auto modes.
 */
export type ChatModelKey =
  | 'cerebras-120b'
  | 'groq-120b'
  | 'groq-20b'

export const CHAT_MODELS: {
  value: ChatModelKey
  label: string
  provider: string
  model: string
}[] = [
  {
    value: 'cerebras-120b',
    label: 'Cerebras gpt-oss-120b',
    provider: 'cerebras',
    model: 'gpt-oss-120b',
  },
  {
    value: 'groq-120b',
    label: 'Groq gpt-oss-120b',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
  },
  {
    value: 'groq-20b',
    label: 'Groq gpt-oss-20b',
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
  },
]

export const chatModelInfo = (key: ChatModelKey) =>
  CHAT_MODELS.find((m) => m.value === key)!

/** Participants in the two Auto modes; only Groq and Cerebras. */
export const autoChain = (): {
  provider: string
  model: string
}[] =>
  ['cerebras-120b', 'groq-120b', 'groq-20b'].map((key) => {
    const { provider, model } = chatModelInfo(key as ChatModelKey)
    return { provider, model }
  })

/**
 * Auto in the model picker races providers by the selected Speed/Accuracy mode.
 * Picking a model by name turns it off, and that model
 * alone answers. Kept in this browser; on by default.
 */
export const useChatAuto = create<{
  auto: boolean
  mode: AutoMode
  setMode: (mode: AutoMode) => void
  setAuto: (auto: boolean) => void
}>()(
  persist(
    (set) => ({
      auto: true,
      mode: 'accuracy',
      setMode: (mode) => set({ mode }),
      setAuto: (auto) => set({ auto }),
    }),
    { name: 'chat-auto', storage: createJSONStorage(() => localStorage) }
  )
)
