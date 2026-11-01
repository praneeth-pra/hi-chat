// Dictation's settings on this device (localStorage), and which engines it
// can use. The setters that also move the open mic live in session.ts.

/**
 * Which service turns your voice into text. Soniox gets your dictionary as
 * context terms and Cartesia the 100 that fit; all of them stream live while
 * you talk. Auto races the engines chosen in Settings (Cartesia, Soniox and
 * ElevenLabs by default): as soon as two agree their text
 * is sent, else a judge model writes the best version.
 */
export type DictationEngine = 'elevenlabs' | 'soniox' | 'cartesia' | 'auto'
export const DICTATION_ENGINES: { value: DictationEngine; label: string }[] = [
  { value: 'auto', label: 'Auto (race the chosen engines)' },
  { value: 'soniox', label: 'Soniox (live)' },
  { value: 'cartesia', label: 'Cartesia (live)' },
  { value: 'elevenlabs', label: 'ElevenLabs (live)' },
]
const ENGINE_STORAGE_KEY = 'dictation-engine'

export function getDictationEngine(): DictationEngine {
  try {
    const saved = localStorage.getItem(ENGINE_STORAGE_KEY)
    if (DICTATION_ENGINES.some((e) => e.value === saved))
      return saved as DictationEngine
  } catch {
    // Storage blocked
  }
  return 'auto'
}

export function setDictationEngine(engine: DictationEngine) {
  try {
    localStorage.setItem(ENGINE_STORAGE_KEY, engine)
  } catch {
    // Storage blocked
  }
}

export const REDUCE_ECHO_STORAGE_KEY = 'dictation-reduce-echo'

/** Off by default: retain speech played near the microphone, not only your voice. */
export function getDictationReduceEcho(): boolean {
  try {
    return localStorage.getItem(REDUCE_ECHO_STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export const KEEP_MIC_STORAGE_KEY = 'dictation-keep-mic'

/**
 * Keep the mic open between dictations so the next one starts instantly
 * (macOS shows the mic as in use while Jan is open). On by default.
 */
export function getKeepMicReady(): boolean {
  try {
    return localStorage.getItem(KEEP_MIC_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

/** Engines Auto can race, in tie-break order. */
export const AUTO_ENGINE_CHOICES = [
  'cartesia',
  'soniox',
  'elevenlabs',
] as const satisfies readonly DictationEngine[]
/**
 * Engines on trial: they hear every clip and their text is logged beside the
 * others' (for comparing on real interviews), but it never counts towards
 * what is sent, so trying one can't make dictation worse or slower. None
 * right now: Azure (MAI-Transcribe-2) was removed on 28 Oct after it was
 * the furthest from the other engines on real interviews.
 */
export const TEST_ENGINES: readonly DictationEngine[] = []

export type AutoEngine = (typeof AUTO_ENGINE_CHOICES)[number]
const DEFAULT_AUTO_ENGINES: AutoEngine[] = ['cartesia', 'soniox', 'elevenlabs']
const AUTO_ENGINES_STORAGE_KEY = 'dictation-auto-engines'

/** The engines Auto races, chosen in Settings (at least one). */
export function getAutoEngines(): AutoEngine[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(AUTO_ENGINES_STORAGE_KEY) ?? 'null'
    )
    if (Array.isArray(saved)) {
      const chosen = AUTO_ENGINE_CHOICES.filter((e) => saved.includes(e))
      if (chosen.length) return chosen
    }
  } catch {
    // Storage blocked or unreadable
  }
  return DEFAULT_AUTO_ENGINES
}

export function setAutoEngines(engines: AutoEngine[]) {
  try {
    localStorage.setItem(AUTO_ENGINES_STORAGE_KEY, JSON.stringify(engines))
  } catch {
    // Storage blocked
  }
}
