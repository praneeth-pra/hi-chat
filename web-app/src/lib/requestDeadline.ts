/** Deadlines still settle when an SDK ignores its AbortSignal. */
export async function withRequestDeadline<T>(
  signal: AbortSignal,
  timeoutMs: number,
  run: (controller: AbortController) => Promise<T>
): Promise<T> {
  if (signal.aborted) throw signal.reason
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  let rejectCancelled!: (reason: unknown) => void
  const cancelled = new Promise<never>((_, reject) => {
    rejectCancelled = reject
  })
  const cancel = () => rejectCancelled(controller.signal.reason)
  controller.signal.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(
    () => controller.abort(new Error('Request timed out. Please retry.')),
    timeoutMs
  )
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw controller.signal.reason
        return run(controller)
      }),
      cancelled,
    ])
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', cancel)
  }
}
