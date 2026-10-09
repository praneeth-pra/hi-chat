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
  timeoutMs = SMART_TURN_TIMEOUT_MS
) {
  let model: Model | null = null
  let failed = false
  const ready = load().then(
    (m) => {
      model = m
    },
    (err: Error) => {
      failed = true
      console.warn(`[speaker] Smart Turn unavailable: ${err.message}`)
    }
  )
  return {
    ready,
    /** 'on', 'loading' or 'unavailable', for the log. */
    state: () => (model ? 'on' : failed ? 'unavailable' : 'loading'),
    /** Every block of loopback audio, at 16 kHz. */
    push(samples: Float32Array) {
      model?.push(samples)
    },
    /** How finished the turn sounds right now, or null if unknown in time. */
    async check(): Promise<TurnCheck | null> {
      if (!model) return null
      const late = new Promise<null>((r) =>
        setTimeout(() => r(null), timeoutMs)
      )
      const result = model.predict().then(
        (p) => ({ probability: p.probability, ms: p.duration }),
        () => null
      )
      return Promise.race([result, late])
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
    wasmPath: 'https://unpkg.com/onnxruntime-web@1.23.2/dist/',
  })
  const model = new SmartTurn()
  await model.load()
  return model
}
