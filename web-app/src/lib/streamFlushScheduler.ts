/** Batch tokens without depending on animation frames in a background tab. */
export function createStreamFlushScheduler(
  flush: () => void,
  signal: AbortSignal
) {
  let frame: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending = false
  let disposed = false
  const clear = () => {
    if (frame !== undefined && typeof cancelAnimationFrame !== 'undefined')
      cancelAnimationFrame(frame)
    clearTimeout(timer)
    frame = undefined
    timer = undefined
    pending = false
  }
  const run = () => {
    if (!pending) return
    clear()
    if (!disposed && !signal.aborted) flush()
  }
  const dispose = () => {
    disposed = true
    clear()
    signal.removeEventListener('abort', dispose)
  }
  signal.addEventListener('abort', dispose, { once: true })
  return {
    schedule(immediate = false) {
      if (disposed || signal.aborted) return
      if (immediate) {
        clear()
        flush()
      } else if (!pending) {
        pending = true
        if (typeof requestAnimationFrame !== 'undefined')
          frame = requestAnimationFrame(run)
        timer = setTimeout(run, 40)
      }
    },
    dispose,
  }
}
