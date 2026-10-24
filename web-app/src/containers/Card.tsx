import { cn } from '@/lib/utils'
import { ReactNode } from 'react'

type CardProps = {
  title?: string
  children?: ReactNode
  header?: ReactNode
}

type CardItemProps = {
  title?: string | ReactNode
  description?: string | ReactNode
  descriptionOutside?: string | ReactNode
  align?: 'start' | 'center' | 'end'
  actions?: ReactNode
  column?: boolean
  className?: string
  classNameWrapperAction?: string
}

export function CardItem({
  title,
  description,
  descriptionOutside,
  className,
  classNameWrapperAction,
  align = 'center',
  column,
  actions,
}: CardItemProps) {
  return (
    <>
      <div
        className={cn(
          // A wide control drops below its text instead of squeezing it
          // into a narrow column, so rows read well in a compact window
          'flex flex-wrap justify-between mt-3 first:mt-0 border-b border-main-view-fg/[0.06] pb-3.5 last:border-none last:pb-0 gap-x-6 gap-y-2.5',
          descriptionOutside && 'border-0',
          align === 'start' && 'items-start',
          align === 'center' && 'items-center',
          align === 'end' && 'items-end',
          column && 'flex-col gap-y-0 items-start',
          className
        )}
      >
        <div className={cn('space-y-1.5 min-w-0', !column && 'flex-[1_1_13rem]')}>
          <h1 className="font-medium text-main-view-fg">{title}</h1>
          {description && (
            <span className="text-main-view-fg/55 leading-relaxed text-[0.93em]">
              {description}
            </span>
          )}
        </div>
        {actions && (
          <div
            className={cn(
              'shrink-0 max-w-full',
              classNameWrapperAction,
              column && 'w-full'
            )}
          >
            {actions}
          </div>
        )}
      </div>
      {descriptionOutside && (
        <span className="text-main-view-fg/70 leading-normal">
          {descriptionOutside}
        </span>
      )}
    </>
  )
}

export function Card({ title, children, header }: CardProps) {
  return (
    <div className="bg-main-view border border-main-view-fg/[0.08] p-4 sm:p-5 rounded-xl text-main-view-fg/90 w-full shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      {title && (
        <h1 className="text-main-view-fg font-semibold text-base mb-4 tracking-tight">
          {title}
        </h1>
      )}
      {header && header}
      {children}
    </div>
  )
}
