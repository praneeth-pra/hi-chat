/**
 * Keeps the chat list readable:
 * - chats are named after their first user message (unless the user renamed them)
 * - each chat keeps a message count on its metadata, so the sidebar and the
 *   Clean up dialog don't have to load every chat's messages
 * - chats with no messages remove themselves once they are not open
 *
 * Messages are only read from storage once per chat (when it has no stored
 * count yet); after that the count is kept up to date as messages change.
 */
import { useEffect } from 'react'
import type { ThreadMessage } from '@janhq/core'
import { useThreads } from '@/hooks/useThreads'
import { useMessages } from '@/hooks/useMessages'
import { useAppState } from '@/hooks/useAppState'
import { getServiceHub } from '@/hooks/useServiceHub'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import {
  firstUserText,
  isPlaceholderTitle,
  titleFromMessage,
} from '@/lib/chatList'

/** Chats younger than this are left alone: a send may still be in flight. */
const NEW_CHAT_GRACE_MS = 30_000

export function getMessageCount(thread?: Thread): number | undefined {
  const count = thread?.metadata?.message_count
  return typeof count === 'number' ? count : undefined
}

function canAutoTitle(thread: Thread): boolean {
  return isPlaceholderTitle(thread.title) && !thread.metadata?.title_edited
}

function openThreadId(): string | undefined {
  const { currentThreadId } = useThreads.getState()
  if (currentThreadId) return currentThreadId
  const match = window.location.pathname.match(/\/threads\/([^/?#]+)/)
  return match ? decodeURIComponent(match[1]) : undefined
}

/** Called whenever a message is added to a chat. */
export function noteMessageAdded(message: ThreadMessage) {
  if (message.thread_id === TEMPORARY_CHAT_ID) return
  const thread = useThreads.getState().threads[message.thread_id]
  if (!thread) return

  const metadata: Record<string, unknown> = {}
  const count = getMessageCount(thread)
  if (count !== undefined) metadata.message_count = count + 1

  let title: string | undefined
  if (message.role === 'user' && canAutoTitle(thread)) {
    const text = titleFromMessage(firstUserText([message]))
    if (text) title = text
  }

  if (title !== undefined || Object.keys(metadata).length > 0) {
    useThreads.getState().patchThread(thread.id, { title, metadata })
  }
}

/** Called whenever a message is removed from a chat. */
export function noteMessageDeleted(threadId: string) {
  const thread = useThreads.getState().threads[threadId]
  const count = getMessageCount(thread)
  if (!thread || count === undefined) return
  useThreads.getState().patchThread(threadId, {
    metadata: { message_count: Math.max(0, count - 1) },
  })
}

/** Called after a chat's messages were loaded from storage. */
export function syncThreadFromMessages(
  threadId: string,
  messages: ThreadMessage[]
) {
  const thread = useThreads.getState().threads[threadId]
  if (!thread || threadId === TEMPORARY_CHAT_ID) return
  const patch: { title?: string; metadata: Record<string, unknown> } = {
    metadata: {},
  }
  // Messages added since the read are already in memory
  const count = Math.max(
    messages.length,
    useMessages.getState().getMessages(threadId).length
  )
  if (getMessageCount(thread) !== count) patch.metadata.message_count = count
  if (canAutoTitle(thread)) {
    const text = titleFromMessage(firstUserText(messages))
    if (text) patch.title = text
  }
  if (patch.title !== undefined || Object.keys(patch.metadata).length > 0) {
    useThreads.getState().patchThread(threadId, patch)
  }
}

/**
 * Deletes a chat only when it really has no messages: none in memory, none in
 * storage, it is not open, not starred and no reply is being generated for it.
 */
export async function deleteIfEmpty(threadId: string): Promise<boolean> {
  const isKeeper = () => {
    const thread = useThreads.getState().threads[threadId]
    return (
      !thread ||
      threadId === TEMPORARY_CHAT_ID ||
      thread.isFavorite ||
      threadId === openThreadId() ||
      useMessages.getState().getMessages(threadId).length > 0 ||
      Boolean(useAppState.getState().abortControllers[threadId])
    )
  }
  if (isKeeper()) return false

  const stored = await getServiceHub().messages().fetchMessages(threadId)
  if (stored.length > 0) {
    syncThreadFromMessages(threadId, stored)
    return false
  }
  // The user may have opened it or sent something while we were reading
  if (isKeeper()) return false

  useThreads.getState().deleteThread(threadId)
  return true
}

function isNew(thread: Thread): boolean {
  const updatedMs =
    thread.updated > 1e12 ? thread.updated : thread.updated * 1000
  return Date.now() - updatedMs < NEW_CHAT_GRACE_MS
}

function checkLater(threadId: string) {
  const thread = useThreads.getState().threads[threadId]
  if (!thread) return
  if (isNew(thread)) {
    setTimeout(() => void deleteIfEmpty(threadId), NEW_CHAT_GRACE_MS)
  } else {
    void deleteIfEmpty(threadId)
  }
}

let tidying: Promise<void> | undefined

/**
 * One pass over the loaded chats: fills in message counts and titles for
 * chats that don't have them yet and removes empty chats. Chats that already
 * have a non-zero count are skipped without touching storage.
 */
export function tidyThreads(): Promise<void> {
  if (tidying) return tidying
  tidying = (async () => {
    const threads = Object.values(useThreads.getState().threads).filter(
      (t) => t.id !== TEMPORARY_CHAT_ID
    )
    for (const thread of threads) {
      const count = getMessageCount(thread)
      if (count !== undefined && count > 0) continue
      try {
        if (count === 0) {
          if (!isNew(thread)) await deleteIfEmpty(thread.id)
          continue
        }
        const messages = await getServiceHub()
          .messages()
          .fetchMessages(thread.id)
        if (messages.length === 0) {
          if (!isNew(thread)) await deleteIfEmpty(thread.id)
          continue
        }
        syncThreadFromMessages(thread.id, messages)
      } catch (error) {
        console.warn(`[Threads] Could not tidy thread ${thread.id}:`, error)
      }
    }
  })().finally(() => {
    tidying = undefined
  })
  return tidying
}

/** Removes a chat with no messages once the user navigates away from it. */
export function useEmptyThreadCleanup() {
  useEffect(() => {
    return useThreads.subscribe((state, prev) => {
      const left = prev.currentThreadId
      if (left && left !== state.currentThreadId) checkLater(left)
    })
  }, [])
}
