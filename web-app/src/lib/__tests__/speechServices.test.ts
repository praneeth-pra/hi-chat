import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssistant } from '@/hooks/useAssistant'
import { setDictionary } from '../keyTerms'
import {
  fetchLiveToken,
  fetchLiveKeyWithTerms,
  keyTerms,
  reportSpeech,
} from '../speechServices'

describe('dictation services independent of Speaker', () => {
  beforeEach(() => {
    localStorage.clear()
    useAssistant.setState({ currentAssistant: null })
    vi.unstubAllGlobals()
  })
  it('reads the current assistant vocabulary on each call and retains the saved dictionary', () => {
    setDictionary('Kubernetes\nTerraform')
    expect(keyTerms()).toEqual(['Kubernetes', 'Terraform'])
    useAssistant.setState({
      currentAssistant: { id: 'a', keyterms: ['EKS'] } as Assistant,
    })
    expect(keyTerms()).toEqual(['EKS'])
    useAssistant.setState({
      currentAssistant: { id: 'b', keyterms: ['EC2'] } as Assistant,
    })
    expect(keyTerms()).toEqual(['EC2'])
  })
  it('preserves live token and vocabulary retrieval for dictation engines', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ token: 'temporary', terms: ['EKS'] }))
    )
    vi.stubGlobal('fetch', fetch)
    expect(await fetchLiveToken('elevenlabs')).toBe('temporary')
    expect(await fetchLiveKeyWithTerms('cartesia')).toEqual({
      token: 'temporary',
      terms: ['EKS'],
    })
    expect(fetch.mock.calls[1]).toEqual([
      '/api/live-token',
      expect.objectContaining({ body: JSON.stringify({ engine: 'cartesia' }) }),
    ])
    vi.unstubAllGlobals()
  })
  it('reports dictation diagnostics through the shared speech endpoint without throwing', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', fetch)
    reportSpeech('dictation failed')
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledWith(
      '/api/speech-log',
      expect.objectContaining({ keepalive: true })
    )
    vi.unstubAllGlobals()
  })
})
