import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useProviderModels } from '../useProviderModels'
import { useServiceHub } from '@/hooks/useServiceHub'

// Local minimal provider type for tests
type MockModelProvider = {
  active: boolean
  provider: string
  base_url?: string
  api_key?: string
  settings: any[]
  models: any[]
}

describe('useProviderModels', () => {
  const mockProvider: MockModelProvider = {
    active: true,
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: 'test-api-key',
    settings: [],
    models: [],
  }

  const mockModels = ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo']

  let fetchModelsSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    const hub = (useServiceHub as unknown as () => any)()
    const mockedFetch = vi.fn()
    vi.spyOn(hub, 'providers').mockReturnValue({
      fetchModelsFromProvider: mockedFetch,
    } as any)
    fetchModelsSpy = mockedFetch
  })

  it('should initialize with empty state', () => {
    const { result } = renderHook(() => useProviderModels())

    expect(result.current.models).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(null)
    expect(typeof result.current.refetch).toBe('function')
  })

  it('should not fetch models when provider is undefined', () => {
    renderHook(() => useProviderModels(undefined))
    expect(fetchModelsSpy).not.toHaveBeenCalled()
  })

  it('should not fetch models when provider has no base_url', () => {
    const providerWithoutUrl = { ...mockProvider, base_url: undefined }
    renderHook(() => useProviderModels(providerWithoutUrl))
    expect(fetchModelsSpy).not.toHaveBeenCalled()
  })

  it('should fetch and sort models', async () => {
    fetchModelsSpy.mockResolvedValueOnce(mockModels)

    const { result } = renderHook(() => useProviderModels(mockProvider))

    await waitFor(() => {
      expect(result.current.models).toEqual([
        'gpt-3.5-turbo',
        'gpt-4',
        'gpt-4-turbo',
      ])
    })

    expect(result.current.error).toBe(null)
    expect(fetchModelsSpy).toHaveBeenCalledWith(mockProvider)
  })

  it('should clear models when switching to invalid provider', async () => {
    fetchModelsSpy.mockResolvedValueOnce(mockModels)

    const { result, rerender } = renderHook(
      ({ provider }) => useProviderModels(provider),
      { initialProps: { provider: mockProvider } }
    )

    await waitFor(
      () => {
        expect(result.current.models).toEqual([
          'gpt-3.5-turbo',
          'gpt-4',
          'gpt-4-turbo',
        ])
        expect(result.current.loading).toBe(false)
      },
      { timeout: 500 }
    )

    // Switch to invalid provider
    rerender({ provider: { ...mockProvider, base_url: undefined } })

    expect(result.current.models).toEqual([])
    expect(result.current.error).toBe(null)
    expect(result.current.loading).toBe(false)
  })

  it('should not refetch when provider is undefined', () => {
    const { result } = renderHook(() => useProviderModels(undefined))

    result.current.refetch()

    expect(fetchModelsSpy).not.toHaveBeenCalled()
  })
  it('ignores an old response after the provider is cleared', async () => {
    let finish!: (models: string[]) => void
    fetchModelsSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const provider = {
      ...mockProvider,
      base_url: 'https://models.example/slow',
    }
    const { result, rerender } = renderHook(
      ({ provider }: { provider: MockModelProvider | undefined }) =>
        useProviderModels(provider),
      {
        initialProps: { provider } as {
          provider: MockModelProvider | undefined
        },
      }
    )
    rerender({ provider: undefined })
    await act(async () => {
      finish(['stale-model'])
      await Promise.resolve()
    })
    expect(result.current.models).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('refreshes model access when the API key changes on the same endpoint', async () => {
    fetchModelsSpy
      .mockResolvedValueOnce(['old-account-model'])
      .mockResolvedValueOnce(['new-account-model'])
    const provider = {
      ...mockProvider,
      base_url: 'https://models.example/accounts',
    }
    const { result, rerender } = renderHook(
      ({ provider }) => useProviderModels(provider),
      { initialProps: { provider } }
    )
    await waitFor(() =>
      expect(result.current.models).toEqual(['old-account-model'])
    )
    rerender({ provider: { ...provider, api_key: 'replacement-key' } })
    await waitFor(() =>
      expect(result.current.models).toEqual(['new-account-model'])
    )
    expect(fetchModelsSpy).toHaveBeenCalledTimes(2)
  })
})
