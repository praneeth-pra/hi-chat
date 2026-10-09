import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { IconSparkles } from '@tabler/icons-react'
import { toast } from 'sonner'
import type { ThreadMessage } from '@janhq/core'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useThreads } from '@/hooks/useThreads'
import { useMessages } from '@/hooks/useMessages'
import { getServiceHub } from '@/hooks/useServiceHub'
import { getMessageCount } from '@/hooks/useThreadHygiene'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { route } from '@/constants/routes'
import {
  firstUserText,
  formatShortDate,
  isLikelyJunkChat,
  plainTitle,
  toMillis,
} from '@/lib/chatList'

type JunkChat = {
  thread: Thread
  messageCount: number
  firstMessage: string
}

/**
 * Finds likely-junk chats. Only chats with at most 2 messages are read, so
 * this stays cheap even with a long chat history.
 */
async function findJunkChats(): Promise<JunkChat[]> {
  const threads = Object.values(useThreads.getState().threads).filter(
    (t) =>
      t.id !== TEMPORARY_CHAT_ID &&
      !t.isFavorite &&
      !t.metadata?.project &&
      (getMessageCount(t) ?? 0) <= 2
  )
  const results = await Promise.all(
    threads.map(async (thread) => {
      let messages: ThreadMessage[] = useMessages
        .getState()
        .getMessages(thread.id)
      if (messages.length === 0) {
        messages = await getServiceHub()
          .messages()
          .fetchMessages(thread.id)
          .catch(() => [])
      }
      const chat = {
        thread,
        messageCount: messages.length,
        firstMessage: firstUserText(messages),
      }
      return isLikelyJunkChat({
        messageCount: chat.messageCount,
        firstUserText: chat.firstMessage,
        isFavorite: thread.isFavorite,
        renamed: Boolean(thread.metadata?.title_edited),
      })
        ? chat
        : undefined
    })
  )
  return results
    .filter((chat): chat is JunkChat => Boolean(chat))
    .sort((a, b) => toMillis(b.thread.updated) - toMillis(a.thread.updated))
}

export function CleanUpThreadsDialog() {
  const navigate = useNavigate()
  const deleteThreads = useThreads((state) => state.deleteThreads)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [chats, setChats] = useState<JunkChat[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    findJunkChats()
      .then((found) => {
        if (cancelled) return
        setChats(found)
        setSelected(new Set(found.map((c) => c.thread.id)))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const toggle = (threadId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(threadId)) next.delete(threadId)
      else next.add(threadId)
      return next
    })
  }

  const allSelected = chats.length > 0 && selected.size === chats.length

  const handleDelete = () => {
    const ids = chats.map((c) => c.thread.id).filter((id) => selected.has(id))
    if (ids.length === 0) return
    const openId = useThreads.getState().currentThreadId
    deleteThreads(ids)
    setOpen(false)
    toast.success(
      ids.length === 1 ? 'Deleted 1 chat' : `Deleted ${ids.length} chats`,
      { id: 'clean-up-threads' }
    )
    if (openId && ids.includes(openId)) {
      setTimeout(() => navigate({ to: route.home }), 0)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="h-6 flex items-center gap-1 px-1.5 rounded text-xs text-left-panel-fg/60 hover:text-left-panel-fg hover:bg-left-panel-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-left-panel-fg/10"
          title="Find and delete chats that look like tests or typos"
          onClick={(e) => e.stopPropagation()}
        >
          <IconSparkles size={14} />
          <span>Clean up</span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Clean up chats</DialogTitle>
          <DialogDescription>
            {loading
              ? 'Looking for chats that look like tests or typos…'
              : chats.length > 0
                ? 'These short chats look like tests or typos. Uncheck any you want to keep.'
                : 'Nothing to clean up. Your chats all look like real conversations.'}
          </DialogDescription>
        </DialogHeader>

        {!loading && chats.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 px-2 py-1 text-xs text-main-view-fg/60 cursor-pointer">
              <input
                type="checkbox"
                className="size-3.5 accent-primary cursor-pointer"
                checked={allSelected}
                onChange={() =>
                  setSelected(
                    allSelected
                      ? new Set()
                      : new Set(chats.map((c) => c.thread.id))
                  )
                }
              />
              <span>
                {selected.size} of {chats.length} selected
              </span>
            </label>
            <ul className="max-h-[50vh] overflow-y-auto flex flex-col gap-1 pr-1">
              {chats.map((chat) => (
                <li key={chat.thread.id}>
                  <label className="flex items-start gap-2 rounded-md px-2 py-1.5 cursor-pointer hover:bg-main-view-fg/5">
                    <input
                      type="checkbox"
                      className="mt-1 size-3.5 shrink-0 accent-primary cursor-pointer"
                      checked={selected.has(chat.thread.id)}
                      onChange={() => toggle(chat.thread.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-main-view-fg">
                          {plainTitle(chat.thread.title) || 'New Thread'}
                        </span>
                        <span className="shrink-0 text-xs text-main-view-fg/50">
                          {formatShortDate(chat.thread.updated)}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-main-view-fg/60">
                        {chat.firstMessage
                          ? `“${chat.firstMessage}”`
                          : 'No messages'}
                        {chat.messageCount > 0 &&
                          ` · ${chat.messageCount} ${chat.messageCount === 1 ? 'message' : 'messages'}`}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter className="mt-2 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <DialogClose asChild>
            <Button variant="link" size="sm" className="w-full sm:w-auto">
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            size="sm"
            className="w-full sm:w-auto"
            disabled={loading || selected.size === 0}
            onClick={handleDelete}
          >
            Delete selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
