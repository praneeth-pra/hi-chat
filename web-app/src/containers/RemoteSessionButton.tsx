import { IconBroadcast, IconBroadcastOff } from '@tabler/icons-react'
import { useRemoteSession } from '@/hooks/useRemoteSession'
import { cn } from '@/lib/utils'

// In the chat header: turns the remote session (the mirror to /mirror) on
// and off. Off, the mirror doesn't run, so it costs Hi-chat nothing.

export function RemoteSessionButton() {
  const on = useRemoteSession((s) => s.on)
  const setOn = useRemoteSession((s) => s.setOn)
  const label = on
    ? 'Remote session on: /mirror follows this chat. Click to stop.'
    : 'Remote session off. Click to send this chat to /mirror.'
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
          ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 dark:text-emerald-400'
          : 'hover:bg-main-view-fg/10 hover:text-main-view-fg'
      )}
    >
      {on ? <IconBroadcast size={18} /> : <IconBroadcastOff size={18} />}
      <span className="hidden sm:inline">
        {on ? 'Remote on' : 'Remote off'}
      </span>
    </button>
  )
}
