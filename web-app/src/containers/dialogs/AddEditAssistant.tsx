import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconFileText, IconUpload, IconX } from '@tabler/icons-react'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { setupAssistant, type SetupFile } from '@/lib/assistantSetup'
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
 * An assistant is just a resume and an optional job description. The name,
 * instructions, documents and key terms are worked out from them when the
 * user saves (lib/assistantSetup.ts), so none of that is shown here.
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
  // When editing, the first document is the resume and the second the JD
  const savedResume = editing ? initialData?.documents?.[0] : undefined
  const savedJd = editing ? initialData?.documents?.[1] : undefined

  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [jdFile, setJdFile] = useState<File | null>(null)
  const [jdRemoved, setJdRemoved] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const resumeInputRef = useRef<HTMLInputElement>(null)
  const jdInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setResumeFile(null)
    setJdFile(null)
    setJdRemoved(false)
    setStatus(null)
    setBusy(false)
  }, [open, editingKey])

  const resumeName = resumeFile?.name ?? savedResume?.name
  const jdName = jdFile?.name ?? (jdRemoved ? undefined : savedJd?.name)
  const changed = !!resumeFile || !!jdFile || (jdRemoved && !!savedJd)
  const canSave = !busy && !!resumeName && (!editing || changed)

  const readFile = async (file: File): Promise<SetupFile> => {
    const text = await extractDocumentText(file)
    if (!text)
      throw new Error(
        `${file.name} has no readable text (a scanned PDF needs OCR first)`
      )
    return { name: file.name, text }
  }

  const handleSave = async () => {
    setBusy(true)
    try {
      setStatus('Reading the files…')
      const resume = resumeFile ? await readFile(resumeFile) : savedResume
      if (!resume) throw new Error('Upload a resume first')
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
        editing ? initialData : undefined
      )
      onSave(assistant)
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
    <div className="flex items-center gap-2 rounded-lg border border-main-view-fg/10 px-3 py-2">
      <IconFileText size={18} className="shrink-0 text-main-view-fg/50" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="truncate text-xs text-main-view-fg/60" title={name}>
          {name ?? 'Not uploaded'}
        </div>
      </div>
      {name && onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          className="size-7 flex items-center justify-center rounded hover:bg-main-view-fg/10"
          onClick={onRemove}
          disabled={busy}
        >
          <IconX size={14} className="text-main-view-fg/50" />
        </button>
      )}
      <Button variant="outline" size="sm" onClick={onPick} disabled={busy}>
        <IconUpload size={14} />
        {name ? 'Replace' : 'Upload'}
      </Button>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editingKey
              ? t('assistants:editAssistant')
              : t('assistants:addAssistant')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {fileRow('Resume', resumeName, () => resumeInputRef.current?.click())}
          {fileRow(
            'Job description (optional)',
            jdName,
            () => jdInputRef.current?.click(),
            () => {
              setJdFile(null)
              setJdRemoved(true)
            }
          )}
          <input
            ref={resumeInputRef}
            type="file"
            accept={ACCEPTED_DOCUMENT_TYPES}
            className="hidden"
            aria-label="Resume file"
            onChange={(e) => {
              setResumeFile(e.target.files?.[0] ?? null)
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
          {status && (
            <div className="text-xs text-main-view-fg/60" role="status">
              {status}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handleSave} disabled={!canSave}>
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
