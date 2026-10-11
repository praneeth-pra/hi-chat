import { useEffect, useRef, useState } from 'react'
import { IconCopy, IconListDetails } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useMessages } from '@/hooks/useMessages'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  collectChatPrompts,
  extractChatQuestions,
  type ChatQuestion,
} from '@/lib/chatQuestions'
import { toast } from 'sonner'
import type { ThreadMessage } from '@janhq/core'
const EMPTY_MESSAGES: ThreadMessage[] = []

export function ChatQuestionsDialog({ thread }: { thread: Thread }) {
  const [open, setOpen] = useState(false)
  const [questions, setQuestions] = useState<ChatQuestion[] | null>(null)
  const [error, setError] = useState<string>()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const controller = useRef<AbortController | null>(null)
  const messages = useMessages(
    (state) => state.messages[thread.id] ?? EMPTY_MESSAGES
  )
  const promptCount = collectChatPrompts(messages).length

  useEffect(() => () => controller.current?.abort(), [thread.id])

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      controller.current?.abort()
      controller.current = null
      setRunning(false)
    }
    setOpen(next)
  }

  const extract = async () => {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setRunning(true)
    setQuestions(null)
    setError(undefined)
    try {
      const prompts = collectChatPrompts(
        useMessages.getState().getMessages(thread.id)
      )
      const result = await extractChatQuestions(
        thread,
        prompts,
        useModelProvider.getState().providers,
        request.signal,
        (complete, total) => {
          if (controller.current === request)
            setProgress(`${complete} of ${total} batches checked`)
        }
      )
      if (controller.current === request && !request.signal.aborted)
        setQuestions(result)
    } catch (failure) {
      if (controller.current === request && !request.signal.aborted) {
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not extract questions. Please retry.'
        )
      }
    } finally {
      if (controller.current === request) {
        controller.current = null
        setRunning(false)
      }
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        questions
          ?.map((question, index) => `${index + 1}. ${question.text}`)
          .join('\n\n') ?? ''
      )
      toast.success('Questions copied')
    } catch {
      toast.error('Could not copy questions')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Questions in this chat"
          title="Questions in this chat"
          className="size-8 flex items-center justify-center rounded hover:bg-main-view-fg/10 cursor-pointer"
        >
          <IconListDetails size={18} />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Questions in this chat</DialogTitle>
          <DialogDescription>
            Extract questions from this chat's {promptCount} prompts using a
            120B judge. Answers and attachments are excluded.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={extract}
            disabled={running || !promptCount}
          >
            {running
              ? 'Extracting…'
              : questions === null
                ? 'Extract questions'
                : 'Refresh questions'}
          </Button>
          {running && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                controller.current?.abort()
                controller.current = null
                setRunning(false)
              }}
            >
              Cancel
            </Button>
          )}
          {!!questions?.length && (
            <Button size="sm" variant="outline" onClick={copy}>
              <IconCopy size={16} />
              Copy all
            </Button>
          )}
        </div>
        {running && (
          <p role="status" className="text-sm text-main-view-fg/60">
            {progress || 'Checking prompts…'}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {questions !== null && (
          <div className="max-h-[55vh] overflow-y-auto">
            {questions.length ? (
              <ol className="list-decimal pl-5 space-y-3 text-sm">
                {questions.map((question, index) => (
                  <li
                    key={`${question.promptIndex}-${index}`}
                    className="whitespace-pre-wrap break-words"
                  >
                    {question.text}
                    <span className="block text-xs text-main-view-fg/50 mt-1">
                      Prompt {question.promptIndex}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-main-view-fg/60">
                No questions were found in these prompts.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
