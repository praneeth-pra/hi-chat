import { useEffect, useState } from 'react'
import {
  IconMicrophone,
  IconPlayerStopFilled,
  IconRefresh,
  IconX,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { isPlatformTauri } from '@/lib/platform/utils'
import {
  cancelDictation,
  dismissFailedDictation,
  readyMicEarly,
  retryDictation,
  toggleDictation,
  useDictation,
} from '@/lib/dictation'

function elapsed(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * A dot that breathes while listening; its halo swells with your voice.
 * Only transform and opacity change, so the browser animates it on the GPU.
 */
function BreathingDot({ level }: { level?: number }) {
  const voice = level === undefined ? undefined : Math.min(1, level * 1.6)
  return (
    <span
      className="relative flex size-5 items-center justify-center shrink-0"
      aria-hidden
    >
      <span
        className={cn(
          'absolute inset-0 rounded-full bg-current opacity-15',
          voice === undefined
            ? 'animate-[breathe_1.8s_ease-in-out_infinite]'
            : 'transition-transform duration-100'
        )}
        style={
          voice === undefined
            ? undefined
            : { transform: `scale(${0.55 + voice * 0.65})` }
        }
      />
      <span className="relative size-2 rounded-full bg-current animate-[breathe-core_1.8s_ease-in-out_infinite]" />
    </span>
  )
}

/**
 * A row above the prompt while dictating: a breathing dot that follows your
 * voice and the time, then "Transcribing" while the engines finish.
 * When a dictation fails its audio is kept, and the row offers Retry.
 */
export function DictationBanner() {
  const { status, level, startedAt, failed } = useDictation()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (status !== 'recording') return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [status])
  if (isPlatformTauri()) return null
  if (status === 'idle' && failed)
    return (
      <div
        data-test-id="dictation-failed"
        role="alert"
        className="flex items-center gap-2 mx-2 mt-2 px-2 h-8 rounded-md text-xs bg-destructive/10 text-destructive"
      >
        <span className="truncate" title={failed}>
          Dictation failed: {failed}
        </span>
        <button
          type="button"
          onClick={() => void retryDictation()}
          className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded-sm font-medium hover:bg-destructive/15 shrink-0"
        >
          <IconRefresh size={14} aria-hidden />
          Retry
        </button>
        <button
          type="button"
          aria-label="Discard the failed dictation"
          onClick={dismissFailedDictation}
          className="p-1 rounded-sm hover:bg-destructive/15 shrink-0"
        >
          <IconX size={14} />
        </button>
      </div>
    )
  if (status === 'idle') return null

  return (
    <div
      data-test-id="dictation-banner"
      className="flex items-center gap-2.5 mx-2 mt-2 pl-2 pr-1 h-9 rounded-full text-[13px] bg-main-view-fg/[0.04] text-main-view-fg"
    >
      {status === 'transcribing' ? (
        <>
          <BreathingDot />
          <span className="text-main-view-fg/70">Transcribing…</span>
        </>
      ) : (
        <>
          <BreathingDot level={status === 'recording' ? level : undefined} />
          <span className="font-medium">
            {status === 'starting' ? 'Opening the mic…' : 'Listening'}
          </span>
          {status === 'recording' && (
            <>
              <span className="tabular-nums text-main-view-fg/55">
                {elapsed(Math.max(0, now - startedAt))}
              </span>
              <span className="hidden sm:inline text-main-view-fg/45">
                Tap Left Control to send · Esc to discard
              </span>
            </>
          )}
          <button
            type="button"
            aria-label="Cancel dictation"
            onClick={cancelDictation}
            className="ml-auto size-7 flex items-center justify-center rounded-full text-main-view-fg/55 hover:text-main-view-fg hover:bg-main-view-fg/[0.07]"
          >
            <IconX size={14} />
          </button>
        </>
      )}
    </div>
  )
}

/** Mic button in the chat toolbar: click to dictate, click again to send. */
export function DictationButton() {
  const status = useDictation((s) => s.status)
  useEffect(() => {
    if (!isPlatformTauri()) readyMicEarly()
  }, [])
  if (isPlatformTauri()) return null
  const recording = status === 'recording' || status === 'starting'
  const label = recording ? 'Stop and send dictation' : 'Dictate'

  return (
    <button
      type="button"
      data-test-id="dictation-toggle"
      aria-pressed={recording}
      aria-label={label}
      title={label}
      disabled={status === 'transcribing'}
      onClick={toggleDictation}
      className={cn(
        'h-7 px-2 flex items-center rounded-sm hover:bg-main-view-fg/10 transition-colors',
        recording ? 'text-main-view-fg' : 'text-main-view-fg/50'
      )}
    >
      {recording ? (
        <IconPlayerStopFilled size={16} />
      ) : (
        <IconMicrophone size={16} />
      )}
    </button>
  )
}
