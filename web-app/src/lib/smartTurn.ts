/**
 * Smart Turn v3 (Pipecat, BSD 2-clause): a small audio model that hears
 * whether the interviewer has finished their turn, from intonation as well as
 * words. It runs in the browser on the loopback audio; the text judge still
 * decides what was said. Chosen 8 Oct 2026 after the judge research (see the
 * "Judge redesign research" doc): multi-part questions with 3-5 s pauses were
 * answered piece by piece.
 *
 * Every clip logs its score (turn=0.87). With the setting on, a question the
 * judge would send is held while the model says the interviewer is mid-turn,
 * so the next part joins it; it goes out when they stop, or when you speak.
 */

export const SMART_TURN_STORAGE_KEY = 'speaker-smart-turn'

/** Off by default until the logs show it helps on real interviews. */
export function getSmartTurn(): boolean {
  try {
    return localStorage.getItem(SMART_TURN_STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function setSmartTurn(on: boolean) {
  try {
    localStorage.setItem(SMART_TURN_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Storage blocked: the default stays in effect
  }
}

/** Below this, the turn counts as unfinished and a question is held. */
export const SMART_TURN_HOLD_BELOW = 0.3
/** How long a held question waits for the next part before it goes out. */
export const SMART_TURN_HOLD_MS = 5000
/** A check slower than this is skipped, so it never delays a clip. */
export const SMART_TURN_TIMEOUT_MS = 500

export type TurnCheck = { probability: number; ms: number }

type Model = {
  load(): Promise<void>
  push(samples: Float32Array, sampleRate?: number): void
  predict(): Promise<{ probability: number; duration: number }>
}

/**
 * Listens along with the loopback audio. Loading starts at once and takes a
 * few seconds the first time (the model comes from Hugging Face, then from
 * the browser cache); until then, or if it fails, checks return null.
 */
export function createTurnListener(
  load: () => Promise<Model> = loadSmartTurn,
  timeoutMs = SMART_TURN_TIMEOUT_MS,
  options: {
    loadTimeoutMs?: number
    onState?: (state: string, reason?: string) => void
  } = {}
) {
  let model: Model | null = null
  let failed = false
  let disposed = false
  const unavailable = (reason: string) => {
    failed = true
    options.onState?.('unavailable', reason.slice(0, 200))
    console.warn(`[speaker] Smart Turn unavailable: ${reason}`)
  }
  options.onState?.('loading')
  let loadingTimer: ReturnType<typeof setTimeout>
  const cutoff = new Promise<null>((resolve) => {
    loadingTimer = setTimeout(() => {
      if (!disposed)
        unavailable('Model loading exceeded the 30-second readiness budget')
      resolve(null)
    }, options.loadTimeoutMs ?? 30000)
  })
  const loaded = load().then(
    (m) => m,
    (err: Error) => {
      if (!disposed) unavailable(err.message)
      return null
    }
  )
  const ready = Promise.race([loaded, cutoff]).then((m) => {
    clearTimeout(loadingTimer)
    if (!m || disposed || failed) return
    model = m
    options.onState?.('on')
  })
  return {
    ready,
    state: () => (failed ? 'unavailable' : model ? 'on' : 'loading'),
    dispose() {
      disposed = true
      clearTimeout(loadingTimer)
    },
    push(samples: Float32Array) {
      if (!failed && !disposed) model?.push(samples)
    },
    async check(): Promise<TurnCheck | null> {
      if (!model || failed || disposed) return null
      let timer: ReturnType<typeof setTimeout>
      const late = new Promise<null>((r) => {
        timer = setTimeout(() => r(null), timeoutMs)
      })
      const result = model.predict().then(
        (p) => ({ probability: p.probability, ms: p.duration }),
        () => {
          if (!disposed) unavailable('Prediction failed')
          return null
        }
      )
      try {
        return await Promise.race([result, late])
      } finally {
        clearTimeout(timer!)
      }
    },
  }
}

export type TurnListener = ReturnType<typeof createTurnListener>

async function loadSmartTurn(): Promise<Model> {
  // Loaded only when listening starts, so the runtime stays out of the page
  const [{ SmartTurn }, web] = await Promise.all([
    import('@micdrop/smart-turn'),
    import('@micdrop/smart-turn/web'),
  ])
  // The runtime's WebAssembly files must match the installed version
  web.setSmartTurnOptions({
    executionProvider: 'wasm',
    wasmPath: 'https://unpkg.com/onnxruntime-web@1.23.2/dist/',
  })
  const model = new SmartTurn()
  await model.load()
  return model
}
