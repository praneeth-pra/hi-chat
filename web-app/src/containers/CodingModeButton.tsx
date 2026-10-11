import { IconCode } from '@tabler/icons-react'
import { useCodingMode } from '@/hooks/useCodingMode'
import { isPlatformTauri } from '@/lib/platform/utils'
import { cn } from '@/lib/utils'

export function CodingModeButton() {
  const { coding, setCoding } = useCodingMode()
  if (isPlatformTauri()) return null
  return (
    <button
      type="button"
      data-test-id="coding-toggle"
      aria-pressed={coding}
      aria-label="Coding mode"
      title="Coding mode"
      onClick={() => setCoding(!coding)}
      className={cn(
        'h-7 px-2 flex items-center gap-1 rounded-sm text-xs whitespace-nowrap hover:bg-main-view-fg/10 transition-colors',
        coding ? 'text-accent bg-accent/10' : 'text-main-view-fg/50'
      )}
    >
      <IconCode size={16} />
      {coding && <span className="hidden sm:inline">Coding</span>}
    </button>
  )
}
