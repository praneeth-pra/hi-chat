import { useState } from 'react'
import { IconTrash } from '@tabler/icons-react'
import { useThreads } from '@/hooks/useThreads'
import { DeleteThreadDialog } from './dialogs/DeleteThreadDialog'
import { ChatQuestionsDialog } from './dialogs/ChatQuestionsDialog'
import { MirrorLinkButton } from './MirrorLinkButton'
import { RemoteSessionButton } from './RemoteSessionButton'
import { DictationToggleButton } from './DictationToggleButton'

export function ThreadActions({ thread }: { thread: Thread }) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deleteThread = useThreads((state) => state.deleteThread)
  return (
    <div className="relative z-20 flex items-center gap-1 text-main-view-fg/40">
      <DictationToggleButton />
      <RemoteSessionButton />
      <MirrorLinkButton />
      <ChatQuestionsDialog key={thread.id} thread={thread} />
      <button
        type="button"
        title="Delete this chat"
        aria-label="Delete this chat"
        onClick={() => setDeleteOpen(true)}
        className="size-8 flex items-center justify-center rounded hover:bg-main-view-fg/10 hover:text-destructive cursor-pointer"
      >
        <IconTrash size={18} />
      </button>
      <DeleteThreadDialog
        thread={thread}
        onDelete={deleteThread}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        withoutTrigger
      />
    </div>
  )
}
