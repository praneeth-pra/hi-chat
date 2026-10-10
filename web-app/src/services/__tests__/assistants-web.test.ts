import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  WebAssistantsService,
  WEB_ASSISTANTS_STORAGE_KEY,
  migratingStore,
} from '../assistants/web'

describe('WebAssistantsService', () => {
  let service: WebAssistantsService

  beforeEach(() => {
    localStorage.removeItem(WEB_ASSISTANTS_STORAGE_KEY)
    service = new WebAssistantsService()
  })

  it('starts with the built-in assistant', async () => {
    expect((await service.getAssistants())?.map((x) => x.id)).toEqual(['jan'])
  })

  it('shows the built-in assistant saved as "Jan" as Hi-chat', async () => {
    localStorage.setItem(
      WEB_ASSISTANTS_STORAGE_KEY,
      JSON.stringify([
        { id: 'jan', name: 'Jan' },
        { id: 'a', name: 'Jan' },
      ])
    )
    const names = (await new WebAssistantsService().getAssistants())?.map(
      (x) => x.name
    )
    expect(names).toEqual(['Hi-chat', 'Jan'])
  })

  it('saves, updates and deletes assistants in localStorage', async () => {
    const a = { id: 'a', name: 'A', instructions: 'Use bullets' } as any
    await service.createAssistant(a)
    await service.createAssistant({ id: 'b', name: 'B' } as any)
    await service.createAssistant({ ...a, instructions: 'Be brief' })

    const saved = await service.getAssistants()
    expect(saved?.map((x) => x.id)).toEqual(['jan', 'a', 'b'])
    expect((saved?.[1] as any).instructions).toBe('Be brief')

    await service.deleteAssistant({ id: 'b' } as any)
    expect((await service.getAssistants())?.map((x) => x.id)).toEqual(['jan', 'a'])
  })
})

describe('migratingStore', () => {
  const memory = (value?: any[]) => {
    let saved = value
    return {
      get: vi.fn(async () => saved),
      set: vi.fn(async (a: any[]) => {
        saved = a
      }),
    }
  }

  it('moves assistants from localStorage into the database once', async () => {
    const primary = memory()
    const legacy = memory([{ id: 'a', name: 'A' }])
    const clear = vi.fn()
    const store = migratingStore(primary, legacy, clear)

    expect(await store.get()).toEqual([{ id: 'a', name: 'A' }])
    await store.get()
    expect(primary.set).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('leaves localStorage alone when the database already has assistants', async () => {
    const primary = memory([{ id: 'b', name: 'B' }])
    const clear = vi.fn()
    const store = migratingStore(primary, memory([{ id: 'a' }]), clear)
    expect(await store.get()).toEqual([{ id: 'b', name: 'B' }])
    expect(clear).not.toHaveBeenCalled()
  })

  it('keeps using localStorage when the database fails', async () => {
    const primary = {
      get: vi.fn(async () => {
        throw new Error('blocked')
      }),
      set: vi.fn(),
    }
    const legacy = memory([{ id: 'a', name: 'A' }])
    const store = migratingStore(primary, legacy, vi.fn())
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await store.get()).toEqual([{ id: 'a', name: 'A' }])
    await store.set([])
    expect(legacy.set).toHaveBeenCalledWith([])
  })

  it('saves quick edits in order without losing any', async () => {
    const service = new WebAssistantsService(memory())
    await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        service.createAssistant({ id, name: id } as any)
      )
    )
    expect((await service.getAssistants())?.map((x) => x.id)).toEqual([
      'jan',
      'a',
      'b',
      'c',
    ])
  })
})
