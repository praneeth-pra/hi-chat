import { create } from 'zustand'
import type { VoiceLeveler } from '@/lib/speechAudio'
import type { DictationEngine } from './settings'
import type { LiveStream } from './engines'

// Dictation's state: the store the UI follows, and one recording's data.

export type DictationStatus = 'idle' | 'starting' | 'recording' | 'transcribing'

type DictationState = {
  status: DictationStatus
  /** Loudness of the last ~40 ms (0-1), for the recording animation. */
  level: number
  /** When recording started (ms). */
  startedAt: number
  /** Why the last dictation failed; its audio is kept for retryDictation(). */
  failed?: string
}

export const useDictation = create<DictationState>(() => ({
  status: 'idle',
  level: 0,
  startedAt: 0,
}))

/** A dictation stops by itself after this long. */
export const MAX_DICTATION_MS = 9.5 * 60 * 1000
/**
 * A dictation stops by itself after this long without sound: one left running streams to all three paid
 * engines the whole time (23 Oct: sessions left on for 7 to 100+ minutes).
 */
export const SILENCE_STOP_MS = 2 * 60 * 1000
/** Quieter than this (RMS) counts as silence: a quiet room, not a voice. */
export const SOUND_RMS = 0.015

/** Whether this recording has had no sound for SILENCE_STOP_MS. */
export function silentTooLong(
  rec: Pick<Recording, 'lastSound'>,
  now: number
): boolean {
  return rec.lastSound !== undefined && now - rec.lastSound >= SILENCE_STOP_MS
}

/** Shorter than this is a slip of the key: nothing is sent. */
export const MIN_DICTATION_MS = 400

export type Recording = {
  rate: number
  /** Computer audio: lifts a quiet, muffled far-side voice before the engines */
  leveler?: VoiceLeveler
  engine: DictationEngine
  /** Live engines: the stream that gets every block as it comes */
  live?: LiveStream
  /** Auto: the live engines that each get every block */
  autoLive?: { engine: DictationEngine; stream: LiveStream }[]
  /** Auto: each engine's latest live text (Auto · Instant compares with it) */
  heardLive?: Map<DictationEngine, string>
  /**
   * Every block at 16 kHz, for the batch route when the live engines fail
   * or hear nothing (~64 KB a second)
   */
  audio: Float32Array[]
  limit: ReturnType<typeof setTimeout>
  /** When the mic last heard sound (ms), for auto-stop on silence */
  lastSound?: number
  /** Auto-stop has already stopped it */
  autoStopped?: boolean
}
