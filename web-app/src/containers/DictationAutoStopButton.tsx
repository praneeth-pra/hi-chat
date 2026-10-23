import { IconZzz, IconZzzOff } from '@tabler/icons-react'
import { useDictationAutoStop } from '@/hooks/useDictationAutoStop'
import { cn } from '@/lib/utils'

// In the chat header: whether a dictation stops by itself after 2 minutes
// of silence (lib/dictation.ts).

export function DictationAutoStopButton() {
  const on = useDictationAutoStop((s) => s.on)
  const setOn = useDictationAutoStop((s) => s.setOn)
  const label = on
    ? 'Auto-stop on: dictation stops after 2 minutes of silence. Click to turn off.'
    : 'Auto-stop off: dictation runs until you stop it. Click to turn on.'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={() => setOn(!on)}
      className={cn(
        'h-8 flex items-center gap-1.5 rounded px-2 text-xs font-medium cursor-pointer transition-colors',
        on
          ? 'bg-sky-500/15 text-sky-600 hover:bg-sky-500/25 dark:text-sky-400'
          : 'hover:bg-main-view-fg/10 hover:text-main-view-fg'
      )}
    >
      {on ? <IconZzz size={18} /> : <IconZzzOff size={18} />}
      <span className="hidden sm:inline">
        {on ? 'Auto-stop' : 'No auto-stop'}
      </span>
    </button>
  )
}
