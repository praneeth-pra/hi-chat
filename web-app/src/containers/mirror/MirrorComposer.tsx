import type { CSSProperties } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

/**
 * Hi-chat's message box, as it is: what is being typed there shows here as
 * it is typed (read only), dimmed while an answer is written.
 */
export function MirrorComposer({
  text,
  busy,
  style,
}: {
  text: string
  busy: boolean
  style?: CSSProperties
}) {
  const { t } = useTranslation()
  return (
    <div
      style={style}
      className="mx-auto w-full shrink-0 px-4 pt-2 pb-3 lg:mx-0 lg:px-0"
    >
      <div
        className={cn(
          'overflow-hidden rounded-3xl shadow-lg shadow-black/5',
          busy && 'opacity-70'
        )}
      >
        <div
          aria-label="Hi-chat's message box"
          className={cn(
            'max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-3xl border border-main-view-fg/[0.08] bg-main-view px-4 py-4 text-[14px] leading-relaxed text-main-view-fg dark:bg-surface',
            !text && 'text-main-view-fg/40'
          )}
        >
          {text || t('common:placeholder.chatInput')}
        </div>
      </div>
    </div>
  )
}
