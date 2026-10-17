import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { APP_FONTS, useAppFont } from '@/hooks/useAppFont'
import { cn } from '@/lib/utils'

export function FontFamilySwitcher() {
  const { font, setFont } = useAppFont()
  const current = APP_FONTS.find((f) => f.id === font) ?? APP_FONTS[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span
          title="Font"
          className="flex cursor-pointer items-center gap-1 px-2.5 py-1 rounded-lg border border-main-view-fg/10 bg-main-view-fg/[0.04] hover:bg-main-view-fg/[0.08] transition-colors text-sm outline-none text-main-view-fg font-medium"
        >
          {current.label}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {APP_FONTS.map((item) => (
          <DropdownMenuItem
            key={item.id}
            className={cn(
              'cursor-pointer my-0.5 flex flex-col items-start gap-0',
              font === item.id && 'bg-main-view-fg/5'
            )}
            style={{ fontFamily: item.stack }}
            onClick={() => setFont(item.id)}
          >
            <span className="text-[15px]">{item.label}</span>
            <span className="text-xs text-main-view-fg/50">
              What is Amazon ECS?
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
