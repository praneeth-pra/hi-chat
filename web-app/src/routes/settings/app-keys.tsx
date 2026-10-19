import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { appShortcuts, useAppShortcuts } from '@/lib/appShortcuts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.app_keys as any)({
  component: AppKeys,
})

const chip =
  'cursor-pointer rounded-sm hover:bg-main-view-fg/15 bg-main-view-fg/10 transition-all duration-200 ease-in-out px-2 py-1'

function AppKeys() {
  const { t } = useTranslation()
  const { actions, recording, unavailable, answered } = useAppShortcuts()
  const [late, setLate] = useState(false)

  useEffect(() => {
    appShortcuts('list')
    const wait = setTimeout(() => setLate(true), 1500)
    // Leaving the page stops a recording that is still waiting
    return () => {
      clearTimeout(wait)
      if (useAppShortcuts.getState().recording) appShortcuts('cancel')
    }
  }, [])

  return (
    <div className="flex flex-col h-full">
      <HeaderPage>
        <h1 className="font-medium">{t('common:settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-48px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            <Card title="App keys">
              <p className="text-main-view-fg/70 text-sm mb-2">
                The keys the Hi-chat app listens for anywhere on your computer.
                Press Change, then the new keys: a key with modifiers (such as
                fn N or Ctrl + Left), or a modifier tapped on its own (such as
                Left Control). Esc cancels. Keys another action used move to
                this one.
              </p>
              {!answered && late && (
                <p className="text-main-view-fg/70 text-sm">
                  This version of the app can't change its keys yet. Update the
                  app (Settings &gt; General &gt; Check for updates), then come
                  back here.
                </p>
              )}
              {unavailable && (
                <p className="text-main-view-fg/70 text-sm">{unavailable}</p>
              )}
              {actions.map((action) => (
                <CardItem
                  key={action.id}
                  title={action.label}
                  className="flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-y-2"
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      {recording === action.id ? (
                        <span className="font-medium text-main-view-fg/80">
                          {action.hold
                            ? 'Press the modifier to hold…'
                            : 'Press the new keys…'}
                        </span>
                      ) : action.keys.length ? (
                        action.keys.map((key) => (
                          <span
                            key={key}
                            className="px-3 py-1 bg-main-view-fg/5 rounded-md font-medium"
                          >
                            {key}
                          </span>
                        ))
                      ) : (
                        <span className="text-main-view-fg/50">Off</span>
                      )}
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        disabled={!!unavailable}
                        onClick={() =>
                          appShortcuts(
                            recording === action.id ? 'cancel' : 'record',
                            action.id
                          )
                        }
                      >
                        <div className={chip}>
                          {recording === action.id ? 'Cancel' : 'Change'}
                        </div>
                      </Button>
                      {action.keys.length > 0 && recording !== action.id && (
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0"
                          onClick={() => appShortcuts('clear', action.id)}
                        >
                          <div className={chip}>Turn off</div>
                        </Button>
                      )}
                      {!action.isDefault && recording !== action.id && (
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0"
                          onClick={() => appShortcuts('reset', action.id)}
                        >
                          <div className={chip}>Default</div>
                        </Button>
                      )}
                    </div>
                  }
                />
              ))}
              {actions.some((a) => !a.isDefault) && (
                <div className="pt-2">
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0"
                    onClick={() => appShortcuts('reset')}
                  >
                    <div className={chip}>Reset all to defaults</div>
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
