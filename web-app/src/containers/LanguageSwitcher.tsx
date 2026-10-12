import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useAppTranslation } from '@/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'id', label: 'Bahasa' },
  { value: 'pl', label: 'Polski' },
  { value: 'vn', label: 'Tiếng Việt' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'cs', label: 'Čeština' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'ja', label: '日本語' },
  { value: 'ru', label: 'Русский' },
]

export default function LanguageSwitcher() {
  const { i18n, t } = useAppTranslation()
  const { setCurrentLanguage, currentLanguage } = useGeneralSetting()

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng)
    setCurrentLanguage(lng as Language)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span
          title={t('common:changeLanguage')}
          className="flex cursor-pointer items-center gap-1 px-2.5 py-1 rounded-lg border border-main-view-fg/10 bg-main-view-fg/[0.04] hover:bg-main-view-fg/[0.08] transition-colors text-sm outline-none text-main-view-fg font-medium"
        >
          {LANGUAGES.find(
            (lang: { value: string; label: string }) =>
              lang.value === currentLanguage
          )?.label || t('common:english')}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-24">
        {LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.value}
            className={cn(
              'cursor-pointer my-0.5',
              currentLanguage === lang.value && 'bg-main-view-fg/5'
            )}
            onClick={() => changeLanguage(lang.value)}
          >
            {lang.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
