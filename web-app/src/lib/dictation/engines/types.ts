import type { LiveTranscriber } from '@/lib/speechLive'
import type { DictationEngine } from '../settings'

/** A live engine's stream: it gets every block while you talk, then its text. */
export type LiveStream = Pick<LiveTranscriber, 'push' | 'finish' | 'abort'> & {
  setPreviewListener?: (listener: (text: string) => void) => void
}

/** One live speech-to-text engine dictation can stream to. */
export type LiveEngineAdapter = {
  engine: DictationEngine
  /** A new stream for one dictation (fetches its token as it opens) */
  open: () => LiveStream
}
