import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { useThreads } from '@/hooks/useThreads'

/** How long a chat is kept after its last message (7 days unless changed); 0 keeps every chat. */
export const RETENTION_CHOICES = [0, 7, 30, 90] as const
export type RetentionDays = (typeof RETENTION_CHOICES)[number]

export const useChatRetention = create<{
  days: RetentionDays
  setDays: (days: RetentionDays) => void
}>()(
  persist(
    (set) => ({
      days: 7,
      setDays: (days) => {
        set({ days })
        deleteOldChats()
      },
    }),
    {
      name: localStorageKey.chatRetention,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

const DAY = 24 * 60 * 60

/**
 * The chats untouched for longer than days: never a favourite, the chat
 * open now, or one with no known date.
 */
export function oldChats(
  threads: Thread[],
  days: number,
  currentId: string | undefined,
  now = Date.now() / 1000
): string[] {
  if (!days) return []
  const before = now - days * DAY
  return threads
    .filter(
      (t) =>
        !t.isFavorite &&
        t.id !== currentId &&
        typeof t.updated === 'number' &&
        t.updated > 0 &&
        t.updated < before
    )
    .map((t) => t.id)
}

/** Deletes the chats older than the chosen period, if one is chosen. */
export function deleteOldChats(now = Date.now() / 1000): number {
  const { days } = useChatRetention.getState()
  const { threads, currentThreadId, deleteThreads } = useThreads.getState()
  const ids = oldChats(Object.values(threads), days, currentThreadId, now)
  if (ids.length) deleteThreads(ids)
  return ids.length
}
