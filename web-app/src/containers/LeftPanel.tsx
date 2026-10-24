import { Link, useRouterState } from '@tanstack/react-router'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import {
  IconLayoutSidebar,
  IconDots,
  IconEdit,
  IconSettings,
  IconStar,
  IconMessage,
  IconX,
  IconSearch,
} from '@tabler/icons-react'
import { route } from '@/constants/routes'
import ThreadList from './ThreadList'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { useThreads } from '@/hooks/useThreads'

import { useTranslation } from '@/i18n/react-i18next-compat'
import { useMemo, useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useSmallScreen } from '@/hooks/useMediaQuery'
import { useClickOutside } from '@/hooks/useClickOutside'

import {
  CleanUpThreadsDialog,
  DeleteAllThreadsDialog,
} from '@/containers/dialogs'

const mainMenus = [
  {
    title: 'common:newChat',
    icon: IconEdit,
    route: route.home,
    isEnabled: true,
  },
]

const secondaryMenus = [
  {
    title: 'common:settings',
    icon: IconSettings,
    route: route.settings.general,
    isEnabled: true,
  },
]

const LeftPanel = () => {
  const open = useLeftPanel((state) => state.open)
  const setLeftPanel = useLeftPanel((state) => state.setLeftPanel)
  const { t } = useTranslation()
  const [searchTerm, setSearchTerm] = useState('')

  const isSmallScreen = useSmallScreen()
  const prevScreenSizeRef = useRef<boolean | null>(null)
  const isInitialMountRef = useRef(true)
  const panelRef = useRef<HTMLElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  // Determine if we're in a resizable context (large screen with panel open)
  const isResizableContext = !isSmallScreen && open

  // Use click outside hook for panel with debugging
  useClickOutside(
    () => {
      if (isSmallScreen && open) {
        setLeftPanel(false)
      }
    },
    null,
    [panelRef.current, searchContainerRef.current]
  )

  // Auto-collapse panel only when window is resized
  useEffect(() => {
    const handleResize = () => {
      const currentIsSmallScreen = window.innerWidth <= 768

      // Skip on initial mount
      if (isInitialMountRef.current) {
        isInitialMountRef.current = false
        prevScreenSizeRef.current = currentIsSmallScreen
        return
      }

      // Only trigger if the screen size actually changed
      if (
        prevScreenSizeRef.current !== null &&
        prevScreenSizeRef.current !== currentIsSmallScreen
      ) {
        if (currentIsSmallScreen && open) {
          setLeftPanel(false)
        } else if (!open) {
          setLeftPanel(true)
        }
        prevScreenSizeRef.current = currentIsSmallScreen
      }
    }

    // Add resize listener
    window.addEventListener('resize', handleResize)

    // Initialize the previous screen size on mount
    if (isInitialMountRef.current) {
      prevScreenSizeRef.current = window.innerWidth <= 768
      isInitialMountRef.current = false
    }

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [setLeftPanel, open])

  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })

  const deleteAllThreads = useThreads((state) => state.deleteAllThreads)
  const unstarAllThreads = useThreads((state) => state.unstarAllThreads)
  const getFilteredThreads = useThreads((state) => state.getFilteredThreads)
  const threads = useThreads((state) => state.threads)

  const filteredThreads = useMemo(() => {
    return getFilteredThreads(searchTerm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getFilteredThreads, searchTerm, threads])

  // Memoize categorized threads based on filteredThreads
  const favoritedThreads = useMemo(() => {
    return filteredThreads.filter((t) => t.isFavorite)
  }, [filteredThreads])

  const unFavoritedThreads = useMemo(() => {
    return filteredThreads.filter((t) => !t.isFavorite && !t.metadata?.project)
  }, [filteredThreads])

  // A compact window opens on the chat, not on the drawer, and Esc closes it
  useEffect(() => {
    if (window.innerWidth <= 768) setLeftPanel(false)
  }, [setLeftPanel])
  useEffect(() => {
    if (!isSmallScreen || !open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setLeftPanel(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isSmallScreen, open, setLeftPanel])

  // Disable body scroll when panel is open on small screens
  useEffect(() => {
    if (isSmallScreen && open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [isSmallScreen, open])

  return (
    <>
      {/* Backdrop overlay for small screens */}
      {isSmallScreen && open && !IS_IOS && !IS_ANDROID && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur z-30"
          onClick={(e) => {
            // Don't close if clicking on search container or if currently searching
            if (searchContainerRef.current?.contains(e.target as Node)) {
              return
            }
            setLeftPanel(false)
          }}
        />
      )}
      <aside
        ref={panelRef}
        className={cn(
          'text-left-panel-fg overflow-hidden',
          // Resizable context: full height and width, no margins
          isResizableContext && 'h-full w-full',
          // Small screen context: fixed positioning and styling
          // Compact window: a drawer over the chat, narrow enough that the
          // chat still shows beside it and a click there closes it
          isSmallScreen &&
            'fixed h-full pb-[calc(env(safe-area-inset-bottom)+env(safe-area-inset-top))] bg-main-view z-50 border-r border-left-panel-fg/10 shadow-[8px_0_32px_rgba(0,0,0,0.25)] px-1 w-[min(18rem,85%)]',
          // Default context: original styling
          !isResizableContext &&
            !isSmallScreen &&
            'w-48 shrink-0 rounded-lg m-2 mr-0',
          // Visibility controls
          open
            ? 'opacity-100 visibility-visible'
            : 'w-0 absolute -top-100 -left-100 visibility-hidden'
        )}
      >
        <div className="flex items-center justify-between h-12 px-1.5">
          <Link
            to={route.home}
            onClick={() => isSmallScreen && setLeftPanel(false)}
            className="flex items-center gap-2 px-1.5 py-1 rounded-xl hover:bg-left-panel-fg/[0.06] transition-colors"
          >
            <img
              src="/images/hi-chat-logo.png"
              alt=""
              className="size-6 rounded-full"
            />
            <span className="font-medium text-left-panel-fg">Hi-chat</span>
          </Link>
          <button
            className="size-8 cursor-pointer flex items-center justify-center rounded-xl hover:bg-left-panel-fg/[0.08] transition-colors"
            onClick={() => setLeftPanel(!open)}
            aria-label="Close sidebar"
          >
            <IconLayoutSidebar size={18} className="text-left-panel-fg/70" />
          </button>
        </div>

        <div className="flex flex-col gap-y-1 overflow-hidden mt-0 !h-[calc(100%-48px)]">
          <div className="space-y-0.5 py-1 px-1">
            {mainMenus.map((menu) => {
              if (!menu.isEnabled) {
                return null
              }

              // Regular menu items must have route and icon
              if (!menu.route || !menu.icon) return null

              const isActive = currentPath === menu.route
              return (
                <Link
                  key={menu.title}
                  to={menu.route}
                  onClick={() => isSmallScreen && setLeftPanel(false)}
                  data-test-id={`menu-${menu.title}`}
                  activeOptions={{ exact: true }}
                  className={cn(
                    'flex items-center gap-2.5 cursor-pointer py-2 px-2.5 rounded-xl transition-colors hover:bg-left-panel-fg/[0.06]',
                    isActive &&
                      menu.route !== route.home &&
                      'bg-left-panel-fg/[0.08]'
                  )}
                >
                  <menu.icon size={18} className="text-left-panel-fg/80" />
                  <span className="text-left-panel-fg/90">{t(menu.title)}</span>
                </Link>
              )
            })}
            <div
              ref={searchContainerRef}
              className="relative"
              data-ignore-outside-clicks
            >
              <IconSearch className="absolute size-[18px] top-1/2 left-2.5 -translate-y-1/2 text-left-panel-fg/80 pointer-events-none" />
              <input
                type="text"
                placeholder={t('common:search')}
                className="w-full h-9 pl-[38px] pr-8 bg-transparent rounded-xl text-left-panel-fg placeholder:text-left-panel-fg/90 hover:bg-left-panel-fg/[0.06] focus:bg-left-panel-fg/[0.06] focus:placeholder:text-left-panel-fg/40 focus:outline-none transition-colors"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-left-panel-fg/70 hover:text-left-panel-fg"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation() // prevent bubbling
                    setSearchTerm('')
                  }}
                >
                  <IconX size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col h-full overflow-y-scroll w-[calc(100%+6px)]">
            <div className="flex flex-col w-full h-full overflow-y-auto overflow-x-hidden mb-3">
              <div className="h-full w-full overflow-y-auto">
                {favoritedThreads.length > 0 && (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="block text-xs text-left-panel-fg/50 px-2.5 font-medium sticky top-0">
                        {t('common:favorites')}
                      </span>
                      <div className="relative">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="size-6 flex cursor-pointer items-center justify-center rounded hover:bg-left-panel-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-left-panel-fg/10">
                              <IconDots
                                size={18}
                                className="text-left-panel-fg/60"
                              />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="bottom" align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                unstarAllThreads()
                                toast.success(
                                  t('common:toast.allThreadsUnfavorited.title'),
                                  {
                                    id: 'unfav-all-threads',
                                    description: t(
                                      'common:toast.allThreadsUnfavorited.description'
                                    ),
                                  }
                                )
                              }}
                            >
                              <IconStar size={16} />
                              <span>{t('common:unstarAll')}</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <div className="flex flex-col mb-4">
                      <ThreadList
                        threads={favoritedThreads}
                        isFavoriteSection={true}
                      />
                      {favoritedThreads.length === 0 && (
                        <p className="text-xs text-left-panel-fg/50 px-2.5 font-medium">
                          {t('chat.status.empty', { ns: 'chat' })}
                        </p>
                      )}
                    </div>
                  </>
                )}

                {unFavoritedThreads.length > 0 && (
                  <div className="group/recents flex items-center justify-between mb-2">
                    <span className="block text-xs text-left-panel-fg/50 px-2.5 font-medium">
                      {t('common:recents')}
                    </span>
                    {/* Housekeeping stays hidden until the pointer is on this row */}
                    <div className="relative flex items-center gap-0.5 opacity-0 group-hover/recents:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 transition-opacity">
                      <CleanUpThreadsDialog />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="size-6 flex cursor-pointer items-center justify-center rounded hover:bg-left-panel-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-left-panel-fg/10"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                            }}
                          >
                            <IconDots
                              size={18}
                              className="text-left-panel-fg/60"
                            />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="bottom" align="end">
                          <DeleteAllThreadsDialog
                            onDeleteAll={deleteAllThreads}
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )}

                {filteredThreads.length === 0 && searchTerm.length > 0 && (
                  <div className="px-1 mt-2">
                    <span className="block text-xs text-left-panel-fg/50 px-2.5 font-medium mb-2">
                      {t('common:recents')}
                    </span>

                    <div className="flex items-center gap-1 text-left-panel-fg/80">
                      <IconSearch size={18} />
                      <h6 className="font-medium text-base">
                        {t('common:noResultsFound')}
                      </h6>
                    </div>
                    <p className="text-left-panel-fg/60 mt-1 text-xs leading-relaxed">
                      {t('common:noResultsFoundDesc')}
                    </p>
                  </div>
                )}

                {Object.keys(threads).length === 0 && !searchTerm && (
                  <>
                    <div className="px-1 mt-2">
                      <div className="flex items-center gap-1 text-left-panel-fg/80">
                        <IconMessage size={18} />
                        <h6 className="font-medium text-base">
                          {t('common:noThreadsYet')}
                        </h6>
                      </div>
                      <p className="text-left-panel-fg/60 mt-1 text-xs leading-relaxed">
                        {t('common:noThreadsYetDesc')}
                      </p>
                    </div>
                  </>
                )}

                <div className="flex flex-col">
                  <ThreadList threads={unFavoritedThreads} groupByDate />
                </div>
              </div>
            </div>

            {secondaryMenus.map((menu) => {
              if (!menu.isEnabled) {
                return null
              }

              // Regular menu items must have route and icon
              if (!menu.route || !menu.icon) return null

              const isActive = menu.route.includes(route.settings.index)
                ? currentPath.includes(route.settings.index)
                : currentPath === menu.route
              return (
                <Link
                  key={menu.title}
                  to={menu.route}
                  onClick={() => isSmallScreen && setLeftPanel(false)}
                  data-test-id={`menu-${menu.title}`}
                  activeOptions={{ exact: true }}
                  className={cn(
                    'flex items-center gap-2.5 cursor-pointer hover:bg-left-panel-fg/[0.06] py-2 mx-1 my-0.5 px-2 rounded-xl transition-colors',
                    isActive && 'bg-left-panel-fg/[0.08]'
                  )}
                >
                  <menu.icon size={18} className="text-left-panel-fg/70" />
                  <span className="text-left-panel-fg/90">{t(menu.title)}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </aside>

    </>
  )
}

export default LeftPanel
