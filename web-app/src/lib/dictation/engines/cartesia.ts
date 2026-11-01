import { fetchLiveKeyWithTerms, keyTerms } from '@/lib/speechServices'
import { CartesiaLiveTranscriber } from '@/lib/speechLive'
import type { LiveEngineAdapter } from './types'

/** Cartesia, live: gets the 100 dictionary terms that fit. */
export const cartesiaLive: LiveEngineAdapter = {
  engine: 'cartesia',
  open: () =>
    new CartesiaLiveTranscriber(
      fetchLiveKeyWithTerms('cartesia'),
      undefined,
      keyTerms()
    ),
}
