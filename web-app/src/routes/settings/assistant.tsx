import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { useAssistant } from '@/hooks/useAssistant'

import HeaderPage from '@/containers/HeaderPage'
import {
  IconCirclePlus,
  IconDownload,
  IconPencil,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import AddEditAssistant from '@/containers/dialogs/AddEditAssistant'
import { DeleteAssistantDialog } from '@/containers/dialogs'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { PlatformGuard } from '@/lib/platform/PlatformGuard'
import { PlatformFeature } from '@/lib/platform/types'
import { Button } from '@/components/ui/button'
import SettingsMenu from '@/containers/SettingsMenu'
import {
  downloadAssistants,
  importAssistants,
  parseAssistants,
} from '@/lib/assistantTransfer'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.assistant as any)({
  component: Assistant,
})

function Assistant() {
  return (
    <PlatformGuard feature={PlatformFeature.ASSISTANTS}>
      <AssistantContent />
    </PlatformGuard>
  )
}

function AssistantContent() {
  const { t } = useTranslation()
  const { assistants, addAssistant, updateAssistant, deleteAssistant } =
    useAssistant()
  const [open, setOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const importInput = useRef<HTMLInputElement>(null)

  // Reads an exported file; assistants with the same id are replaced
  const handleImport = async (file: File) => {
    try {
      const incoming = parseAssistants<Assistant>(await file.text())
      if (!incoming.length) {
        toast.error('No assistants found in that file')
        return
      }
      const { added, updated } = importAssistants(
        incoming,
        assistants,
        addAssistant,
        updateAssistant
      )
      toast.success(`Imported ${added} new, updated ${updated}`)
    } catch (error) {
      toast.error('Could not read that file', { description: String(error) })
    }
  }

  const handleDelete = (id: string) => {
    setDeletingId(id)
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = () => {
    if (deletingId) {
      deleteAssistant(deletingId)
      setDeleteConfirmOpen(false)
      setDeletingId(null)
    }
  }

  const handleSave = (assistant: Assistant) => {
    if (editingKey) {
      updateAssistant(assistant)
    } else {
      addAssistant(assistant)
    }
    setOpen(false)
    setEditingKey(null)
  }

  return (
    <div className="flex h-full flex-col justify-center">
      <HeaderPage>
        <div className="flex items-center justify-between gap-2 w-full">
          <span className="truncate">{t('assistants:title')}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="relative z-20"
              title="Download all assistants as a file"
              onClick={() => downloadAssistants(assistants)}
            >
              <IconDownload size={16} />
              <span className="hidden sm:inline">Export</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="relative z-20"
              title="Add assistants from an exported file"
              onClick={() => importInput.current?.click()}
            >
              <IconUpload size={16} />
              <span className="hidden sm:inline">Import</span>
            </Button>
            <input
              ref={importInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) handleImport(file)
              }}
            />
            <Button
              onClick={() => {
                setEditingKey(null)
                setOpen(true)
              }}
              size="sm"
              className="relative z-20"
            >
              <IconCirclePlus size={16} />
              <span className="sm:hidden">Add</span>
              <span className="hidden sm:inline">Add Assistant</span>
            </Button>
          </div>
        </div>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="space-y-3 p-4 flex-1 min-w-0 overflow-y-auto">
          {assistants
            .slice()
            .sort((a, b) => a.created_at - b.created_at)
            .map((assistant) => (
              <div
                className="bg-main-view-fg/3 py-2 px-4 rounded-lg flex items-center gap-4"
                key={assistant.id}
              >
                <div className="flex items-start gap-3 flex-1">
                  {assistant?.avatar && (
                    <div className="shrink-0 w-8 h-8 relative flex items-center justify-center bg-main-view-fg/4 rounded-md">
                      <AvatarEmoji
                        avatar={assistant?.avatar}
                        imageClassName="w-5 h-5 object-contain"
                        textClassName="text-lg"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-medium text-main-view-fg/80 line-clamp-1">
                      {assistant.name}
                    </h3>
                    <p className="text-main-view-fg/50 text-sm line-clamp-2 mt-0.5">
                      {assistant.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center">
                  <button
                    className="size-8 cursor-pointer flex items-center justify-center rounded-md hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                    title={t('assistants:editAssistant')}
                    onClick={() => {
                      setEditingKey(assistant.id)
                      setOpen(true)
                    }}
                  >
                    <IconPencil size={16} className="text-main-view-fg/50" />
                  </button>
                  <button
                    className="size-8 cursor-pointer flex items-center justify-center rounded-md hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out"
                    title={t('assistants:deleteAssistant')}
                    onClick={() => handleDelete(assistant.id)}
                  >
                    <IconTrash size={16} className="text-main-view-fg/50" />
                  </button>
                </div>
              </div>
            ))}
        </div>
        <AddEditAssistant
          open={open}
          onOpenChange={setOpen}
          editingKey={editingKey}
          initialData={
            editingKey ? assistants.find((a) => a.id === editingKey) : undefined
          }
          onSave={handleSave}
        />
        <DeleteAssistantDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          onConfirm={confirmDelete}
        />
      </div>
    </div>
  )
}
