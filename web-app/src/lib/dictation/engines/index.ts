import type { DictationEngine } from '../settings'
import { cartesiaLive } from './cartesia'
import { elevenLabsLive, transcribe } from './elevenlabs'
import { sonioxLive } from './soniox'
import type { LiveEngineAdapter, LiveStream } from './types'

export type { LiveEngineAdapter, LiveStream }
export { transcribe }

/** Every live engine, each behind the same LiveEngineAdapter. */
export const LIVE_ENGINES: readonly LiveEngineAdapter[] = [
  elevenLabsLive,
  sonioxLive,
  cartesiaLive,
]

/** A new live stream for `engine` (none for Auto, which races several). */
export function liveStream(engine: DictationEngine): LiveStream | undefined {
  return LIVE_ENGINES.find((e) => e.engine === engine)?.open()
}
