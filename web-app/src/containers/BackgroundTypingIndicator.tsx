import { IconKeyboard } from '@tabler/icons-react'
import { useBackgroundTyping } from '@/hooks/useBackgroundTyping'
import { isPlatformTauri } from '@/lib/platform/utils'
import { cn } from '@/lib/utils'

export function BackgroundTypingIndicator() {
  const enabled = useBackgroundTyping((state) => state.enabled)
  if (isPlatformTauri()) return null
  const label = `Background typing ${enabled ? 'on' : 'off'}`
  return (
    <span
      role="img"
      aria-label={label}
      title={`${label} · Tap Option to ${enabled ? 'disable' : 'enable'}`}
      className={cn(
        'h-7 px-1.5 flex items-center gap-1 rounded-sm text-xs',
        enabled ? 'text-accent bg-accent/10' : 'text-main-view-fg/35'
      )}
    >
      <IconKeyboard size={16} aria-hidden="true" />
      {enabled && <span className="hidden sm:inline">Typing</span>}
    </span>
  )
}
