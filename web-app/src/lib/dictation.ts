/**
 * Dictation: speech heard by your selected microphone, streamed to live
 * speech-to-text engines while you record. Stopping dictation delivers the
 * text to the chat.
 *
 * This file only re-exports, so `@/lib/dictation` keeps working; the code is
 * in lib/dictation/:
 * - settings.ts: the engine, echo and keep-mic settings, Auto's engines
 * - state.ts: the store the UI follows (useDictation) and a Recording
 * - session.ts: the mic, and starting, stopping, retrying a dictation
 * - auto.ts: Auto racing the live engines and choosing the text
 * - engines/: one adapter per engine (ElevenLabs live and batch, Soniox,
 *   Cartesia) behind LiveEngineAdapter
 * - wav.ts: 16-bit PCM WAV encoding
 */

export {
  DICTATION_ENGINES,
  AUTO_ENGINE_CHOICES,
  TEST_ENGINES,
  getDictationEngine,
  setDictationEngine,
  getDictationReduceEcho,
  getKeepMicReady,
  getAutoEngines,
  setAutoEngines,
  type AutoEngine,
  type DictationEngine,
} from './dictation/settings'
export {
  useDictation,
  MAX_DICTATION_MS,
  SILENCE_STOP_MS,
  silentTooLong,
  type DictationStatus,
  type Recording,
} from './dictation/state'
export {
  AUTO_DEADLINE_MS,
  countedEngines,
  fastAgreement,
  withoutFillers,
  pickBest,
  trimStrayStart,
  longestAgreeing,
  gatherAuto,
  type EngineText,
} from './dictation/auto'
export { textAgreement } from '@/lib/dictationJudge'
export { encodeWav, wavBytes } from './dictation/wav'
export {
  setDictationReduceEcho,
  letGoOfMic,
  setKeepMicReady,
  readyMicEarly,
  switchMic,
  dotLevel,
  onBlock,
  startDictation,
  stopDictation,
  retryDictation,
  dismissFailedDictation,
  reportAuto,
  cancelDictation,
  toggleDictation,
} from './dictation/session'
