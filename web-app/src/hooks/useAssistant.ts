import { getServiceHub } from '@/hooks/useServiceHub'
import { Assistant as CoreAssistant } from '@janhq/core'
import { create } from 'zustand'
import { toast } from 'sonner'
import { localStorageKey } from '@/constants/localStorage'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'

interface AssistantState {
  assistants: Assistant[]
  currentAssistant: Assistant | null
  addAssistant: (assistant: Assistant) => void
  updateAssistant: (assistant: Assistant) => void
  deleteAssistant: (id: string) => void
  setCurrentAssistant: (assistant: Assistant, saveToStorage?: boolean) => void
  setAssistants: (assistants: Assistant[]) => void
  getLastUsedAssistant: () => string | null
  setLastUsedAssistant: (assistantId: string) => void
  initializeWithLastUsed: () => void
}

// Helper functions for localStorage
const getLastUsedAssistantId = (): string | null => {
  try {
    return localStorage.getItem(localStorageKey.lastUsedAssistant)
  } catch (error) {
    console.debug('Failed to get last used assistant from localStorage:', error)
    return null
  }
}

const setLastUsedAssistantId = (assistantId: string) => {
  try {
    localStorage.setItem(localStorageKey.lastUsedAssistant, assistantId)
  } catch (error) {
    console.debug('Failed to set last used assistant in localStorage:', error)
  }
}

export const defaultAssistant: Assistant = {
  id: 'jan',
  name: 'Hi-chat',
  created_at: 1747029866.542,
  parameters: {},
  avatar: '👋',
  description: 'A fast, helpful assistant.',
  instructions:
    'You are a helpful AI assistant. Answer directly, concisely and clearly. Admit when you are unsure rather than making things up.\n\nCurrent date: {{current_date}}',
}

// Platform-aware initial state
const getInitialAssistantState = () => {
  if (PlatformFeatures[PlatformFeature.ASSISTANTS]) {
    return {
      assistants: [defaultAssistant],
      currentAssistant: defaultAssistant,
    }
  } else {
    return {
      assistants: [],
      currentAssistant: null,
    }
  }
}

export const useAssistant = create<AssistantState>((set, get) => ({
  ...getInitialAssistantState(),
  addAssistant: (assistant) => {
    set({ assistants: [...get().assistants, assistant] })
    getServiceHub()
      .assistants()
      .createAssistant(assistant as unknown as CoreAssistant)
      .catch((error) => {
        console.error('Failed to create assistant:', error)
        toast.error('Could not save the assistant', {
          description:
            (error as Error)?.name === 'QuotaExceededError'
              ? 'The browser is out of storage space. Try removing some documents.'
              : String(error),
        })
      })
  },
  updateAssistant: (assistant) => {
    const state = get()
    set({
      assistants: state.assistants.map((a) =>
        a.id === assistant.id ? assistant : a
      ),
      // Update currentAssistant if it's the same assistant being updated
      currentAssistant:
        state.currentAssistant?.id === assistant.id
          ? assistant
          : state.currentAssistant,
    })
    // Create assistant already cover update logic
    getServiceHub()
      .assistants()
      .createAssistant(assistant as unknown as CoreAssistant)
      .catch((error) => {
        console.error('Failed to update assistant:', error)
        toast.error('Could not save the assistant', {
          description:
            (error as Error)?.name === 'QuotaExceededError'
              ? 'The browser is out of storage space. Try removing some documents.'
              : String(error),
        })
      })
  },
  deleteAssistant: (id) => {
    const state = get()
    getServiceHub()
      .assistants()
      .deleteAssistant(
        state.assistants.find((e) => e.id === id) as unknown as CoreAssistant
      )
      .catch((error) => {
        console.error('Failed to delete assistant:', error)
      })

    // Check if we're deleting the current assistant
    const wasCurrentAssistant = state.currentAssistant?.id === id

    set({ assistants: state.assistants.filter((a) => a.id !== id) })

    // If the deleted assistant was current, fallback to default and update localStorage
    if (wasCurrentAssistant) {
      set({ currentAssistant: defaultAssistant })
      setLastUsedAssistantId(defaultAssistant.id)
    }
  },
  setCurrentAssistant: (assistant, saveToStorage = true) => {
    if (assistant !== get().currentAssistant) {
      set({ currentAssistant: assistant })
      if (saveToStorage) {
        setLastUsedAssistantId(assistant.id)
      }
    }
  },
  setAssistants: (assistants) => {
    set({ assistants })
  },
  getLastUsedAssistant: () => {
    return getLastUsedAssistantId()
  },
  setLastUsedAssistant: (assistantId) => {
    setLastUsedAssistantId(assistantId)
  },
  initializeWithLastUsed: () => {
    const lastUsedId = getLastUsedAssistantId()
    if (lastUsedId) {
      const lastUsedAssistant = get().assistants.find(
        (a) => a.id === lastUsedId
      )
      if (lastUsedAssistant) {
        set({ currentAssistant: lastUsedAssistant })
      } else {
        // Fallback to default if last used assistant was deleted
        set({ currentAssistant: defaultAssistant })
        setLastUsedAssistantId(defaultAssistant.id)
      }
    }
  },
}))
