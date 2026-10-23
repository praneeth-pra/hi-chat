import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ThemeSwitcher } from '@/containers/ThemeSwitcher'
import { FontSizeSwitcher } from '@/containers/FontSizeSwitcher'
import { FontFamilySwitcher } from '@/containers/FontFamilySwitcher'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { useCodeblock } from '@/hooks/useCodeblock'
import { Button } from '@/components/ui/button'
import CodeBlockStyleSwitcher from '@/containers/CodeBlockStyleSwitcher'
import { LineNumbersSwitcher } from '@/containers/LineNumbersSwitcher'
import { CodeBlockExample } from '@/containers/CodeBlockExample'
import { toast } from 'sonner'
import { ChatWidthSwitcher } from '@/containers/ChatWidthSwitcher'
import { TokenCounterCompactSwitcher } from '@/containers/TokenCounterCompactSwitcher'
import { ThreadScrollBehaviorSwitcher } from '@/containers/ThreadScrollBehaviorSwitcher'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.interface as any)({
  component: InterfaceSettings,
})

function InterfaceSettings() {
  const { t } = useTranslation()
  const { resetInterface } = useInterfaceSettings()
  const { resetCodeBlockStyle } = useCodeblock()

  return (
    <div className="flex flex-col h-full pb-[calc(env(safe-area-inset-bottom)+env(safe-area-inset-top))]">
      <HeaderPage>
        <h1 className="font-medium">{t('common:settings')}</h1>
      </HeaderPage>
      <div className="flex h-full w-full flex-col sm:flex-row">
        <SettingsMenu />
        <div className="p-4 w-full h-[calc(100%-48px)] overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Interface */}
            <Card title={t('settings:interface.title')}>
              <CardItem
                title={t('settings:interface.theme')}
                description={t('settings:interface.themeDesc')}
                actions={<ThemeSwitcher />}
              />
              <CardItem
                title="Font"
                description="The typeface for the whole app."
                actions={<FontFamilySwitcher />}
              />
              <CardItem
                title={t('settings:interface.fontSize')}
                description={t('settings:interface.fontSizeDesc')}
                actions={<FontSizeSwitcher />}
              />

              <CardItem
                title={t('settings:interface.resetToDefault')}
                description={t('settings:interface.resetToDefaultDesc')}
                actions={
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      resetInterface()
                      toast.success(
                        t('settings:interface.resetInterfaceSuccess'),
                        {
                          id: 'reset-interface',
                          description: t(
                            'settings:interface.resetInterfaceSuccessDesc'
                          ),
                        }
                      )
                    }}
                  >
                    {t('common:reset')}
                  </Button>
                }
              />
            </Card>

            {/* Chat Message */}
            <Card>
              <CardItem
                title={t('settings:interface.chatWidth')}
                description={t('settings:interface.chatWidthDesc')}
              />
              <ChatWidthSwitcher />
              <CardItem
                title={t('settings:interface.tokenCounterCompact')}
                description={t('settings:interface.tokenCounterCompactDesc')}
                actions={<TokenCounterCompactSwitcher />}
              />
            </Card>

            {/* Scroll Behavior */}
            <Card>
              <CardItem
                title={t('settings:interface.threadScrollTitle')}
                description={t('settings:interface.threadScrollDesc')}
              />
              <ThreadScrollBehaviorSwitcher />
            </Card>

            {/* Codeblock */}
            <Card>
              <CardItem
                title={t('settings:interface.codeBlockTitle')}
                description={t('settings:interface.codeBlockDesc')}
                actions={<CodeBlockStyleSwitcher />}
              />
              <CodeBlockExample />
              <CardItem
                title={t('settings:interface.showLineNumbers')}
                description={t('settings:interface.showLineNumbersDesc')}
                actions={<LineNumbersSwitcher />}
              />
              <CardItem
                title={t('settings:interface.resetCodeBlockStyle')}
                description={t('settings:interface.resetCodeBlockStyleDesc')}
                actions={
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      resetCodeBlockStyle()
                      toast.success(
                        t('settings:interface.resetCodeBlockSuccess'),
                        {
                          id: 'code-block-style',
                          description: t(
                            'settings:interface.resetCodeBlockSuccessDesc'
                          ),
                        }
                      )
                    }}
                  >
                    {t('common:reset')}
                  </Button>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
