import { IconKeyboard } from '@tabler/icons-react'
import { useAppTyping } from '@/lib/remoteKeys'
import { cn } from '@/lib/utils'

/** In the Mac or Windows app: shows whether typing into Hi-chat is on. */
export function AppTypingIndicator() {
  const { inApp, typing } = useAppTyping()
  if (!inApp) return null
  const key = navigator.userAgent.includes('HiChatWindows')
    ? 'Right Alt'
    : 'Option'
  const label = `Typing into Hi-chat ${typing ? 'on' : 'off'}`
  return (
    <span
      role="img"
      aria-label={label}
      title={`${label} · Tap ${key} to turn it ${typing ? 'off' : 'on'}`}
      className={cn(
        'h-7 px-1.5 flex items-center gap-1 rounded-sm text-xs',
        typing ? 'text-accent bg-accent/10' : 'text-main-view-fg/35'
      )}
    >
      <IconKeyboard size={16} aria-hidden="true" />
      {typing && <span className="hidden sm:inline">Typing</span>}
    </span>
  )
}
