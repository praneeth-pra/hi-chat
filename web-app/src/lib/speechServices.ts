import { useAssistant } from '@/hooks/useAssistant'
import { activeKeyTerms } from './keyTerms'

/** The current assistant's vocabulary, with the saved dictionary as fallback. */
export function keyTerms(): string[] {
  return activeKeyTerms(useAssistant.getState().currentAssistant?.keyterms)
}

/** The site login (relay/auth.mjs) answers 401 once this browser is signed out. */
const SIGNED_OUT_ERROR = 'Signed out of Hi-chat: reload the page to sign in'

/** Dictation timings and failures are reported in the relay logs. */
export const SPEECH_LOG_URL = '/api/speech-log'

/** Sends one diagnostic line; never prompts and never throws. */
export function reportSpeech(line: string) {
  fetch(SPEECH_LOG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line }),
    keepalive: true,
  }).catch(() => {})
}

/**
 * Live mode: the relay hands out single-use ElevenLabs streaming tokens, or
 * tickets for its own Grok, Muse or Sarvam live
 * socket ({"engine":"grok"|"muse"|"sarvam"}), or temporary Soniox or Cartesia keys
 * ({"engine":"soniox"|"cartesia"}, which come with P's dictionary as `terms`).
 */
type LiveEngine =
  | 'elevenlabs'
  | 'grok'
  | 'muse'
  | 'sarvam'
  | 'soniox'
  | 'cartesia'
export const LIVE_TOKEN_URL = '/api/live-token'

async function requestLiveToken(
  engine: LiveEngine
): Promise<{ token: string; terms?: string[] }> {
  const res = await fetch(LIVE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine }),
  })
  if (res.status === 401) throw new Error(SIGNED_OUT_ERROR)
  if (!res.ok) throw new Error(`Live token failed (${res.status})`)
  return (await res.json()) as { token: string; terms?: string[] }
}

export async function fetchLiveToken(
  engine: LiveEngine = 'elevenlabs'
): Promise<string> {
  return (await requestLiveToken(engine)).token
}

/** A Soniox or Cartesia key and the dictionary terms to send with it. */
export async function fetchLiveKeyWithTerms(
  engine: 'soniox' | 'cartesia'
): Promise<{ token: string; terms: string[] }> {
  const { token, terms } = await requestLiveToken(engine)
  return { token, terms: terms ?? [] }
}
