import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useState, useEffect } from 'react'
import {
  IconChevronDown,
  IconChevronRight,
  IconMenu2,
  IconX,
} from '@tabler/icons-react'
import { useMatches, useNavigate } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

import { useModelProvider } from '@/hooks/useModelProvider'
import { getProviderTitle } from '@/lib/utils'
import ProvidersAvatar from '@/containers/ProvidersAvatar'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
import { inHiChatApp } from '@/lib/appShortcuts'

const SettingsMenu = () => {
  const { t } = useTranslation()
  const [expandedProviders, setExpandedProviders] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const matches = useMatches()
  const navigate = useNavigate()

  const { providers } = useModelProvider()

  // Filter providers that have active API keys (or are llama.cpp which doesn't need one)
  // On web: exclude llamacpp provider as it's not available
  const activeProviders = providers.filter((provider) => {
    if (!provider.active) return false

    // On web version, hide llamacpp provider
    if (
      !PlatformFeatures[PlatformFeature.LOCAL_INFERENCE] &&
      provider.provider === 'llama.cpp'
    ) {
      return false
    }

    return true
  })

  // Check if current route has a providerName parameter and expand providers submenu
  useEffect(() => {
    const hasProviderName = matches.some(
      (match) =>
        match.routeId === '/settings/providers/$providerName' &&
        'providerName' in match.params
    )
    const isProvidersRoute = matches.some(
      (match) => match.routeId === '/settings/providers/'
    )
    if (hasProviderName || isProvidersRoute) {
      setExpandedProviders(true)
    }
  }, [matches])

  // Check if we're in the setup remote provider step
  const stepSetupRemoteProvider = matches.some(
    (match) =>
      match.search &&
      typeof match.search === 'object' &&
      'step' in match.search &&
      match.search.step === 'setup_remote_provider'
  )

  const menuSettings = [
    {
      title: 'common:general',
      route: route.settings.general,
      hasSubMenu: false,
      isEnabled: true,
    },
    {
      title: 'common:attachments',
      route: route.settings.attachments,
      hasSubMenu: false,
      isEnabled: PlatformFeatures[PlatformFeature.FILE_ATTACHMENTS],
    },
    {
      title: 'common:interface',
      route: route.settings.interface,
      hasSubMenu: false,
      isEnabled: true,
    },
    {
      title: 'common:modelProviders',
      route: route.settings.model_providers,
      hasSubMenu: activeProviders.length > 0,
      isEnabled: PlatformFeatures[PlatformFeature.MODEL_PROVIDER_SETTINGS],
    },
    {
      title: 'common:assistants',
      route: route.settings.assistant,
      hasSubMenu: false,
      isEnabled: PlatformFeatures[PlatformFeature.ASSISTANTS],
    },
    {
      title: 'common:keyboardShortcuts',
      route: route.settings.shortcuts,
      hasSubMenu: false,
      isEnabled: PlatformFeatures[PlatformFeature.SHORTCUT],
    },
    {
      title: 'common:appKeys',
      route: route.settings.app_keys,
      hasSubMenu: false,
      isEnabled: inHiChatApp(),
    },
  ]

  const toggleProvidersExpansion = () => {
    setExpandedProviders(!expandedProviders)
  }

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen)
  }

  return (
    <>
      <button
        className="fixed top-[calc(8px+env(safe-area-inset-top))] right-2 sm:hidden size-8 flex cursor-pointer items-center justify-center rounded-lg hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out data-[state=open]:bg-main-view-fg/10 z-40"
        onClick={toggleMenu}
        aria-label="Toggle settings menu"
      >
        {isMenuOpen ? (
          <IconX size={18} className="text-main-view-fg relative z-20" />
        ) : (
          <IconMenu2 size={18} className="text-main-view-fg relative z-20" />
        )}
      </button>
      {/* Compact window: the menu slides over the page; a click beside it closes it */}
      {isMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 sm:hidden"
          onClick={() => setIsMenuOpen(false)}
        />
      )}
      <div
        className={cn(
          'h-full w-48 shrink-0 px-2 pt-3 border-r border-main-view-fg/[0.06] bg-main-view',
          'sm:flex',
          isMenuOpen
            ? 'flex fixed sm:hidden inset-y-0 right-0 z-30 w-56 h-full border-r-0 border-l pt-12 shadow-[-8px_0_32px_rgba(0,0,0,0.25)]'
            : 'hidden'
        )}
      >
        <div className="flex flex-col gap-1 w-full text-main-view-fg/90 font-medium">
          {menuSettings.map((menu) => {
            if (!menu.isEnabled) {
              return null
            }
            return (
              <div key={menu.title}>
                <Link
                  to={menu.route}
                  className="block px-2.5 gap-1.5 cursor-pointer hover:bg-main-view-fg/[0.05] py-1.5 w-full rounded-lg transition-colors [&.active]:bg-primary/[0.08] [&.active]:text-primary"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-main-view-fg/80 in-[.active]:text-primary">
                      {t(menu.title)}
                    </span>
                    {menu.hasSubMenu && (
                      <button
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          toggleProvidersExpansion()
                        }}
                        className="text-main-view-fg/60 hover:text-main-view-fg/80"
                      >
                        {expandedProviders ? (
                          <IconChevronDown size={16} />
                        ) : (
                          <IconChevronRight size={16} />
                        )}
                      </button>
                    )}
                  </div>
                </Link>

                {/* Sub-menu for model providers */}
                {menu.hasSubMenu && expandedProviders && (
                  <div className="ml-2 mt-1 space-y-1 first-step-setup-remote-provider">
                    {activeProviders.map((provider) => {
                      const isActive = matches.some(
                        (match) =>
                          match.routeId ===
                            '/settings/providers/$providerName' &&
                          'providerName' in match.params &&
                          match.params.providerName === provider.provider
                      )

                      return (
                        <div key={provider.provider}>
                          <div
                            className={cn(
                              'flex px-2.5 items-center gap-1.5 cursor-pointer hover:bg-main-view-fg/[0.05] py-1.5 w-full rounded-lg transition-colors [&.active]:bg-main-view-fg/5 text-main-view-fg/80',
                              isActive && 'bg-primary/[0.08] text-primary',
                              // hidden for llama.cpp provider for setup remote provider
                              provider.provider === 'llama.cpp' &&
                                stepSetupRemoteProvider &&
                                'hidden'
                            )}
                            onClick={() =>
                              navigate({
                                to: route.settings.providers,
                                params: {
                                  providerName: provider.provider,
                                },
                                ...(stepSetupRemoteProvider
                                  ? {
                                      search: { step: 'setup_remote_provider' },
                                    }
                                  : {}),
                              })
                            }
                          >
                            <ProvidersAvatar provider={provider} />
                            <div className="truncate">
                              <span>{getProviderTitle(provider.provider)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

export default SettingsMenu
