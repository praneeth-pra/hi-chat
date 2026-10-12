import { useEffect, useState } from 'react'
import { IconLoader2 } from '@tabler/icons-react'

/** Progress without exposing an unchecked draft or inventing a completion ETA. */
export function AccuracyProgress({
  phase,
}: {
  phase: 'searching' | 'drafting' | 'verifying'
}) {
  const [started] = useState(() => Date.now())
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000
    )
    return () => clearInterval(timer)
  }, [started])
  return (
    <div className="py-3 text-sm text-main-view-fg/70">
      <div className="flex items-center gap-2">
        <IconLoader2
          size={16}
          aria-hidden
          className="animate-spin motion-reduce:animate-none shrink-0"
        />
        <span role="status" aria-live="polite">
          {phase === 'searching'
            ? 'Accuracy: searching sources…'
            : phase === 'drafting'
              ? 'Accuracy: preparing an answer…'
              : 'Accuracy: checking the answer…'}
        </span>
        <span
          className="text-xs tabular-nums ml-auto"
          aria-label={`${elapsed} seconds elapsed`}
        >
          {elapsed}s
        </span>
      </div>
      {elapsed >= 10 && (
        <p className="text-xs mt-2 text-main-view-fg/60">
          Taking longer than usual. You can stop this request and retry.
        </p>
      )}
    </div>
  )
}
