import { TARGET_SAMPLE_RATE } from '@/lib/speechAudio'
import { fetchLiveToken, keyTerms } from '@/lib/speechServices'
import { elevenLabsTerms, LiveTranscriber } from '@/lib/speechLive'
import { encodeWav } from '../wav'
import type { LiveEngineAdapter } from './types'

/** ElevenLabs, live: your dictionary goes along as its key terms. */
export const elevenLabsLive: LiveEngineAdapter = {
  engine: 'elevenlabs',
  open: () =>
    new LiveTranscriber(
      fetchLiveToken('elevenlabs'),
      undefined,
      elevenLabsTerms(keyTerms())
    ),
}

/**
 * The relay's batch route (ElevenLabs), for
 * a dictation the live engines lost. Resolves to its text.
 */
export async function transcribe(samples: Float32Array): Promise<string> {
  // The mic had sent (almost) nothing; the engines reject an empty file
  if (samples.length < TARGET_SAMPLE_RATE / 20) return ''
  const body = new FormData()
  body.append('file', encodeWav(samples, TARGET_SAMPLE_RATE), 'dictation.wav')
  body.append('need', '1')
  body.append('require_text', '1')
  const res = await fetch('/api/transcribe', { method: 'POST', body })
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    results?: { ok: boolean; text?: string; error?: string }[]
  }
  if (!res.ok) {
    const errors = data.results?.map((r) => r.error).filter(Boolean)
    throw new Error(errors?.join('; ') || data.error || `status ${res.status}`)
  }
  return (data.results?.find((r) => r.ok && r.text?.trim())?.text ?? '').trim()
}
