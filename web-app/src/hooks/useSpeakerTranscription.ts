import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { EngineTiming } from '@/lib/speakerCaptureSession'
import type { CheckInfo } from '@/lib/speakerFilter'

/** What happened to one clip, shown in the chip's tooltip. */
export type ClipLog = {
  text: string
  sent: boolean
  engines: EngineTiming[]
  check?: CheckInfo
  note?: string
}

export type SpeakerStatus =
  | 'off'
  | 'starting'
  | 'needs-click'
  | 'listening'
  | 'hearing'
  | 'transcribing'
  | 'no-device'
  | 'blocked'
  | 'unsupported'
  | 'error'

type SpeakerTranscriptionState = {
  /** Listening is on by default; the user can switch it off from the chat box. */
  enabled: boolean
  /** Coding mode: screen-share chatter is skipped while coding. Not kept after a reload. */
  coding: boolean
  setCoding: (coding: boolean) => void
  status: SpeakerStatus
  error: string
  /** Questions heard from the speaker, waiting to be sent. */
  queue: string[]
  /** The last few clips, newest first, shown in the chip's tooltip. */
  clips: ClipLog[]
  logClip: (clip: ClipLog) => void
  setEnabled: (enabled: boolean) => void
  setStatus: (status: SpeakerStatus, error?: string) => void
  enqueue: (text: string) => void
  dequeue: () => string | undefined
  /**
   * A fuller wording of the question sent last (the interviewer added to it
   * or asked it again). Replaces it in the queue if it hasn't gone out yet;
   * otherwise the chat replaces that question and its answer.
   */
  revise: (text: string) => void
  /** Waiting for the chat to replace the last speaker question with it. */
  revision: string | null
  takeRevision: () => string | null
  /** The last question the chat sent from the speaker. */
  lastSent: string | null
  setLastSent: (text: string | null) => void
  /**
   * Clips the two judges disagreed on, newest first, shown as chips to send
   * with one tap. Not kept after a reload.
   */
  suggestions: string[]
  suggest: (text: string) => void
  /** Sends the suggestion (through the listener, so it counts as sent). */
  acceptSuggestion: (text: string) => void
  dismissSuggestion: (text: string) => void
}

/** How many suggestion chips show at once. */
export const MAX_SUGGESTIONS = 3

/** The speaker listener sets how an accepted suggestion is sent. */
let suggestionSender: ((text: string) => void) | null = null
export function setSuggestionSender(send: (text: string) => void) {
  suggestionSender = send
  return () => {
    if (suggestionSender === send) suggestionSender = null
  }
}

export const useSpeakerTranscription = create<SpeakerTranscriptionState>()(
  persist(
    (set, get) => ({
      enabled: true,
      status: 'off',
      error: '',
      setEnabled: (enabled) => set({ enabled }),
      coding: false,
      setCoding: (coding) => set({ coding }),
      queue: [],
      clips: [],
      logClip: (clip) =>
        set((state) => ({ clips: [clip, ...state.clips].slice(0, 5) })),
      setStatus: (status, error = '') => set({ status, error }),
      enqueue: (text) => set((state) => ({ queue: [...state.queue, text] })),
      dequeue: () => {
        const [next, ...rest] = get().queue
        set({ queue: rest })
        return next
      },
      revise: (text) =>
        set((state) =>
          state.queue.length
            ? { queue: [...state.queue.slice(0, -1), text] }
            : { revision: text }
        ),
      revision: null,
      takeRevision: () => {
        const text = get().revision
        set({ revision: null })
        return text
      },
      lastSent: null,
      setLastSent: (lastSent) => set({ lastSent }),
      suggestions: [],
      suggest: (text) =>
        set((state) => ({
          suggestions: [
            text,
            ...state.suggestions.filter((t) => t !== text),
          ].slice(0, MAX_SUGGESTIONS),
        })),
      acceptSuggestion: (text) => {
        get().dismissSuggestion(text)
        if (suggestionSender) suggestionSender(text)
        else get().enqueue(text)
      },
      dismissSuggestion: (text) =>
        set((state) => ({
          suggestions: state.suggestions.filter((t) => t !== text),
        })),
    }),
    {
      name: 'jan-web-speaker-transcription',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ enabled: state.enabled }),
    }
  )
)
