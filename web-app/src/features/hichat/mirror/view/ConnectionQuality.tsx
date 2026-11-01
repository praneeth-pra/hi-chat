import type { ScreenStats } from '@/features/hichat/camera/remoteCamera'
import { cn } from '@/lib/utils'
import { screenStatsTitle } from './connectionStatus'

/** The shared screen's readout in its corner: fps, delay, route. */
export function ScreenStatsBadge({
  stats,
  light,
}: {
  stats: ScreenStats | null
  /** Lightened to 720p for this laptop */
  light: boolean
}) {
  if (!(stats && stats.fps > 0)) return null
  return (
    <span
      title={screenStatsTitle(stats)}
      className={cn(
        'absolute bottom-3 left-3 rounded-full border border-white/10 bg-black/60 px-2.5 py-1 text-[11px] font-medium tabular-nums text-white/80 backdrop-blur',
        stats.estimateMs !== null && stats.estimateMs > 150 && 'text-amber-300'
      )}
    >
      {stats.fps} fps
      {stats.estimateMs !== null && ` · ≈${stats.estimateMs} ms`}
      {stats.relay ? ' · relay' : ' · direct'}
      {light && ' · 720p'}
    </span>
  )
}
