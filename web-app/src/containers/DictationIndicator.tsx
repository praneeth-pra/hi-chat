import { useEffect, useState } from 'react'
import {
  IconMicrophone,
  IconPlayerStopFilled,
  IconX,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { isPlatformTauri } from '@/lib/platform/utils'
import {
  DICTATION_ENGINES,
  cancelDictation,
  getDictationEngine,
  toggleDictation,
  useDictation,
} from '@/lib/dictation'
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

function elapsed(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Bars that move with your voice while recording. */
function LevelBars({ level }: { level: number }) {
  const shape = [0.5, 0.8, 1, 0.8, 0.5]
  return (
    <span className="flex items-center gap-0.5 h-4" aria-hidden>
      {shape.map((k, i) => (
        <span
          key={i}
          className="w-0.5 rounded-full bg-destructive transition-[height] duration-75"
          style={{ height: `${Math.max(15, Math.min(100, level * k * 100))}%` }}
        />
      ))}
    </span>
  )
}

/**
 * A row above the prompt while dictating: a pulsing dot, bars that follow
 * your voice and the time, then "Transcribing" while Aqua works.
 */
export function DictationBanner() {
  const { status, level, startedAt } = useDictation()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (status !== 'recording') return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [status])
  if (isPlatformTauri() || status === 'idle') return null

  return (
    <div
      data-test-id="dictation-banner"
      className="flex items-center gap-2 mx-2 mt-2 px-2 h-8 rounded-md text-xs bg-destructive/10 text-destructive"
    >
      {status === 'transcribing' ? (
        <>
          <span className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
          <span>
            Transcribing with{' '}
            {
              DICTATION_ENGINES.find((e) => e.value === getDictationEngine())
                ?.label
            }
            …
          </span>
        </>
      ) : (
        <>
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75 animate-ping" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
          </span>
          <span className="font-medium">
            {status === 'starting' ? 'Opening the mic…' : 'Recording'}
          </span>
          {status === 'recording' && (
            <>
              <LevelBars level={level} />
              <span className="tabular-nums">
                {elapsed(Math.max(0, now - startedAt))}
              </span>
              <span className="hidden sm:inline opacity-70">
                · tap Left Control or click stop to send
              </span>
            </>
          )}
          <button
            type="button"
            aria-label="Cancel dictation"
            onClick={cancelDictation}
            className="ml-auto p-1 rounded-sm hover:bg-destructive/15"
          >
            <IconX size={14} />
          </button>
        </>
      )}
    </div>
  )
}

/** Mic button next to the speaker: click to dictate, click again to send. */
export function DictationButton() {
  const status = useDictation((s) => s.status)
  if (isPlatformTauri()) return null
  const recording = status === 'recording' || status === 'starting'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-test-id="dictation-toggle"
            aria-pressed={recording}
            disabled={status === 'transcribing'}
            onClick={toggleDictation}
            className={cn(
              'h-7 px-2 flex items-center rounded-sm hover:bg-main-view-fg/10 transition-colors',
              recording ? 'text-destructive' : 'text-main-view-fg/50'
            )}
          >
            {recording ? (
              <IconPlayerStopFilled size={16} />
            ) : (
              <IconMicrophone size={16} />
            )}
          </button>
        </TooltipTrigger>
      </Tooltip>
    </TooltipProvider>
  )
}
