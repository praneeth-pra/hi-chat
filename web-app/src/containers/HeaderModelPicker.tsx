import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { useAppState } from '@/hooks/useAppState'
import { cn } from '@/lib/utils'

/** The model name at the top left of a chat, as in Open WebUI */
export function HeaderModelPicker({
  model,
  useLastUsedModel = false,
}: {
  model?: ThreadModel
  useLastUsedModel?: boolean
}) {
  const streaming = useAppState((state) => !!state.streamingContent)
  return (
    <div
      data-testid="header-model-selector"
      className={cn('min-w-0', streaming && 'opacity-50 pointer-events-none')}
    >
      <DropdownModelProvider
        model={model}
        useLastUsedModel={useLastUsedModel}
        variant="header"
      />
    </div>
  )
}
