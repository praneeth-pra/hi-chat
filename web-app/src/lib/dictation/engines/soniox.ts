import { fetchLiveKeyWithTerms, keyTerms } from '@/lib/speechServices'
import { SonioxLiveTranscriber } from '@/lib/speechLive'
import type { LiveEngineAdapter } from './types'

/** Soniox, live: your dictionary goes along as context terms. */
export const sonioxLive: LiveEngineAdapter = {
  engine: 'soniox',
  open: () =>
    new SonioxLiveTranscriber(
      fetchLiveKeyWithTerms('soniox'),
      undefined,
      keyTerms()
    ),
}
