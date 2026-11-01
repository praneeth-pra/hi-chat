import { useState, type RefObject } from 'react'
import { IconGripVertical } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

/** The bar between the shared screen and the text: drag it left or right. */
export function Divider({
  at,
  onMove,
  onDone,
  onReset,
  container,
}: {
  at: number
  onMove: (x: number) => void
  onDone: () => void
  onReset: () => void
  container: RefObject<HTMLDivElement | null>
}) {
  const [dragging, setDragging] = useState(false)
  const x = (e: { clientX: number }) =>
    e.clientX - (container.current?.getBoundingClientRect().left ?? 0)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the shared screen"
      aria-valuenow={Math.round(at)}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
      }}
      onPointerMove={(e) => dragging && onMove(x(e))}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId)
        setDragging(false)
        onDone()
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 96 : 24
        if (e.key === 'ArrowLeft') onMove(at - step)
        else if (e.key === 'ArrowRight') onMove(at + step)
        else return
        e.preventDefault()
        onDone()
      }}
      style={{ left: at }}
      className="group absolute inset-y-0 z-20 flex w-4 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center outline-none"
    >
      <span
        className={cn(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-main-view-fg/15 transition-colors group-hover:bg-accent group-focus-visible:bg-accent',
          dragging && 'bg-accent'
        )}
      />
      <span
        className={cn(
          'relative flex h-10 w-4 items-center justify-center rounded-full border border-main-view-fg/15 bg-main-view text-main-view-fg/60 shadow-sm transition-colors group-hover:border-accent group-hover:text-main-view-fg group-focus-visible:border-accent',
          dragging && 'border-accent text-main-view-fg'
        )}
      >
        <IconGripVertical size={12} />
      </span>
    </div>
  )
}
