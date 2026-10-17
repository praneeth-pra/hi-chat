import { useNavigate } from '@tanstack/react-router'
import {
  IconLayoutSidebar,
  IconPlus,
  IconSearch,
  IconSettings,
} from '@tabler/icons-react'
import { route } from '@/constants/routes'
import { useLeftPanel } from '@/hooks/useLeftPanel'

const railButton =
  'size-10 flex items-center justify-center rounded-xl text-main-view-fg/60 hover:text-main-view-fg hover:bg-main-view-fg/[0.06] transition-colors cursor-pointer'

/**
 * Narrow icon rail shown on wide screens while the chat list is closed, so
 * the conversation keeps one centred column.
 */
export function SideRail() {
  const { setLeftPanel } = useLeftPanel()
  const navigate = useNavigate()

  return (
    <nav className="h-svh w-16 shrink-0 flex flex-col items-center gap-1.5 py-3 border-r border-main-view-fg/[0.07] text-main-view-fg">
      <button
        aria-label="Hi-chat home"
        className="size-8 mb-3 flex items-center justify-center rounded-[9px] bg-main-view-fg text-main-view font-semibold text-sm cursor-pointer"
        onClick={() => navigate({ to: route.home })}
      >
        H
      </button>
      <button
        aria-label="New chat"
        title="New chat"
        className="size-10 flex items-center justify-center rounded-xl bg-surface text-main-view-fg hover:bg-main-view-fg/[0.06] transition-colors cursor-pointer"
        onClick={() => navigate({ to: route.home })}
      >
        <IconPlus size={18} />
      </button>
      <button
        aria-label="Chats"
        title="Chats"
        className={railButton}
        onClick={() => setLeftPanel(true)}
      >
        <IconLayoutSidebar size={18} />
      </button>
      <button
        aria-label="Search chats"
        title="Search chats"
        className={railButton}
        onClick={() => setLeftPanel(true)}
      >
        <IconSearch size={18} />
      </button>
      <button
        aria-label="Settings"
        title="Settings"
        className={`${railButton} mt-auto`}
        onClick={() => navigate({ to: route.settings.general })}
      >
        <IconSettings size={18} />
      </button>
    </nav>
  )
}
