import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { IconFileText, IconUpload, IconX } from '@tabler/icons-react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  savedSetupFiles,
  setupAssistant,
  type SetupFile,
} from '@/lib/assistantSetup'
import {
  ACCEPTED_DOCUMENT_TYPES,
  extractDocumentText,
} from '@/lib/assistantDocuments'

interface AddEditAssistantProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingKey: string | null
  initialData?: Assistant
  onSave: (assistant: Assistant) => void
}

/**
 * An assistant is just a resume, a job description and notes the resume
 * doesn't cover, all optional but at least one needed. The instructions, documents and key terms
 * are worked out from them when the user saves (lib/assistantSetup.ts). The
 * name is too unless the user types one.
 */
export default function AddEditAssistant({
  open,
  onOpenChange,
  editingKey,
  initialData,
  onSave,
}: AddEditAssistantProps) {
  const { t } = useTranslation()
  const editing = !!(editingKey && initialData)
  const saved = editing
    ? savedSetupFiles(initialData?.documents)
    : { resume: undefined, jd: undefined, notes: '' }
  const savedResume = saved.resume
  const savedJd = saved.jd
  const savedContext = saved.notes

  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [resumeRemoved, setResumeRemoved] = useState(false)
  const [jdFile, setJdFile] = useState<File | null>(null)
  const [jdRemoved, setJdRemoved] = useState(false)
  const [contextText, setContextText] = useState('')
  const [name, setName] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const resumeInputRef = useRef<HTMLInputElement>(null)
  const jdInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setResumeFile(null)
    setResumeRemoved(false)
    setJdFile(null)
    setJdRemoved(false)
    setContextText(savedContext)
    setName(editing ? (initialData?.name ?? '') : '')
    setStatus(null)
    setBusy(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingKey])

  const resumeName =
    resumeFile?.name ?? (resumeRemoved ? undefined : savedResume?.name)
  const jdName = jdFile?.name ?? (jdRemoved ? undefined : savedJd?.name)
  const savedName = editing ? (initialData?.name ?? '') : ''
  const nameChanged = name.trim() !== savedName.trim()
  // Anything but the name means working the assistant out again
  const filesChanged =
    !!resumeFile ||
    (resumeRemoved && !!savedResume) ||
    !!jdFile ||
    (jdRemoved && !!savedJd) ||
    contextText.trim() !== savedContext.trim()
  const changed = filesChanged || nameChanged
  const hasSource = !!resumeName || !!jdName || !!contextText.trim()
  const canSave = !busy && hasSource && (!editing || changed)

  const readFile = async (file: File): Promise<SetupFile> => {
    const text = await extractDocumentText(file)
    if (!text)
      throw new Error(
        `${file.name} has no readable text (a scanned PDF needs OCR first)`
      )
    return { name: file.name, text }
  }

  const handleSave = async () => {
    if (editing && initialData && !filesChanged) {
      onSave({ ...initialData, name: name.trim() || initialData.name })
      onOpenChange(false)
      return
    }
    setBusy(true)
    try {
      setStatus('Reading the files…')
      const resume = resumeFile
        ? await readFile(resumeFile)
        : resumeRemoved
          ? undefined
          : savedResume
      const jd = jdFile
        ? await readFile(jdFile)
        : jdRemoved
          ? undefined
          : savedJd
      setStatus('Setting up the assistant…')
      const { getProviderByName } = useModelProvider.getState()
      const groq = getProviderByName('groq')
      const cerebras = getProviderByName('cerebras')
      const assistant = await setupAssistant(
        resume,
        jd,
        {
          groq: { apiKey: groq?.api_key, baseUrl: groq?.base_url },
          cerebras: { apiKey: cerebras?.api_key, baseUrl: cerebras?.base_url },
        },
        editing ? initialData : undefined,
        fetch,
        contextText
      )
      onSave(name.trim() ? { ...assistant, name: name.trim() } : assistant)
      onOpenChange(false)
    } catch (error) {
      setStatus(
        `Couldn't set up the assistant: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setBusy(false)
    }
  }

  const fileRow = (
    label: string,
    name: string | undefined,
    onPick: () => void,
    onRemove?: () => void
  ) => (
    <div className="flex items-center gap-2 rounded-lg border border-main-view-fg/10 px-2.5 py-2 sm:px-3">
      <IconFileText
        size={18}
        className="hidden shrink-0 text-main-view-fg/50 min-[400px]:block"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {label}{' '}
          <span className="font-normal text-main-view-fg/50">(optional)</span>
        </div>
        <div className="truncate text-xs text-main-view-fg/60" title={name}>
          {name ?? 'Not uploaded'}
        </div>
      </div>
      {name && onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          className="size-7 shrink-0 flex items-center justify-center rounded hover:bg-main-view-fg/10"
          onClick={onRemove}
          disabled={busy}
        >
          <IconX size={14} className="text-main-view-fg/50" />
        </button>
      )}
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={onPick}
        disabled={busy}
        aria-label={`${name ? 'Replace' : 'Upload'} ${label}`}
      >
        <IconUpload size={14} />
        <span className="hidden min-[400px]:inline">
          {name ? 'Replace' : 'Upload'}
        </span>
      </Button>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="gap-3 p-4 sm:gap-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {editingKey
              ? t('assistants:editAssistant')
              : t('assistants:addAssistant')}
          </DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-2">
          <div className="space-y-1">
            <div className="text-sm font-medium">
              Name{' '}
              <span className="font-normal text-main-view-fg/50">
                (optional)
              </span>
            </div>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setStatus(null)
              }}
              placeholder="Made for you if left blank"
              aria-label="Assistant name"
              maxLength={60}
              className="text-sm"
              disabled={busy}
            />
          </div>
          {fileRow(
            'Resume',
            resumeName,
            () => resumeInputRef.current?.click(),
            () => {
              setResumeFile(null)
              setResumeRemoved(true)
            }
          )}
          {fileRow(
            'Job description',
            jdName,
            () => jdInputRef.current?.click(),
            () => {
              setJdFile(null)
              setJdRemoved(true)
            }
          )}
          <div className="space-y-1 pt-1">
            <div className="text-sm font-medium">
              Other context{' '}
              <span className="font-normal text-main-view-fg/50">
                (optional)
              </span>
            </div>
            <Textarea
              value={contextText}
              onChange={(e) => {
                setContextText(e.target.value)
                setStatus(null)
              }}
              placeholder="Anything the resume doesn't say: why you're moving on, notice period, expected salary, location, projects not listed…"
              aria-label="Other context"
              className="min-h-20 max-h-40 resize-none text-sm"
              disabled={busy}
            />
          </div>
          <input
            ref={resumeInputRef}
            type="file"
            accept={ACCEPTED_DOCUMENT_TYPES}
            className="hidden"
            aria-label="Resume file"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              setResumeFile(file)
              if (file) setResumeRemoved(false)
              setStatus(null)
              e.target.value = ''
            }}
          />
          <input
            ref={jdInputRef}
            type="file"
            accept={ACCEPTED_DOCUMENT_TYPES}
            className="hidden"
            aria-label="Job description file"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              setJdFile(file)
              if (file) setJdRemoved(false)
              setStatus(null)
              e.target.value = ''
            }}
          />
          {(status || !hasSource) && (
            <div className="text-xs text-main-view-fg/60" role="status">
              {status ?? 'Add a resume, a job description or some context.'}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full sm:w-auto"
          >
            {busy
              ? 'Setting up…'
              : editing
                ? t('assistants:save')
                : 'Create assistant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
