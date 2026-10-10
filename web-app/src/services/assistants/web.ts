/**
 * Web Assistants Service - keeps assistants in the browser, since the web
 * build has no assistant extension. They live in IndexedDB, which has room
 * for many assistants with documents (localStorage holds about 5 MB in
 * all); assistants saved in localStorage by earlier versions are moved over
 * once. Where IndexedDB can't be opened, localStorage is used as before.
 */

import { Assistant } from '@janhq/core'
import type { AssistantsService } from './types'
import { defaultAssistant } from '@/hooks/useAssistant'

export const WEB_ASSISTANTS_STORAGE_KEY = 'jan-web-assistants'

/** Where the assistant list is kept: the whole list under one key. */
export type AssistantStore = {
  get: () => Promise<Assistant[] | undefined>
  set: (assistants: Assistant[]) => Promise<void>
}

export const localStorageStore = (): AssistantStore => ({
  async get() {
    try {
      const raw = localStorage.getItem(WEB_ASSISTANTS_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : undefined
      return Array.isArray(parsed) ? parsed : undefined
    } catch (error) {
      console.warn('Failed to read assistants from localStorage:', error)
      return undefined
    }
  },
  async set(assistants) {
    localStorage.setItem(WEB_ASSISTANTS_STORAGE_KEY, JSON.stringify(assistants))
  },
})

const DB_NAME = 'jan-web'
const STORE = 'kv'
const KEY = 'assistants'

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

export const indexedDbStore = (factory: IDBFactory): AssistantStore => {
  let db: Promise<IDBDatabase> | undefined
  const open = () =>
    (db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        db = undefined
        reject(req.error)
      }
    }))
  const tx = async (mode: IDBTransactionMode) =>
    (await open()).transaction(STORE, mode).objectStore(STORE)
  return {
    async get() {
      const value = await request((await tx('readonly')).get(KEY))
      return Array.isArray(value) ? (value as Assistant[]) : undefined
    },
    async set(assistants) {
      await request((await tx('readwrite')).put(assistants, KEY))
    },
  }
}

/**
 * IndexedDB first. On first use, assistants left in localStorage are copied
 * in and then removed from localStorage. If IndexedDB fails (some private
 * windows), localStorage is used instead.
 */
export function migratingStore(
  primary: AssistantStore,
  legacy: AssistantStore,
  clearLegacy: () => void
): AssistantStore {
  let usable: Promise<AssistantStore> | undefined
  const pick = () =>
    (usable ??= (async () => {
      try {
        if ((await primary.get()) === undefined) {
          const old = await legacy.get()
          if (old) {
            await primary.set(old)
            clearLegacy()
          }
        }
        return primary
      } catch (error) {
        console.warn(
          'IndexedDB unavailable, keeping assistants in localStorage:',
          error
        )
        return legacy
      }
    })())
  return {
    get: async () => (await pick()).get(),
    set: async (assistants) => (await pick()).set(assistants),
  }
}

const defaultStore = (): AssistantStore =>
  typeof indexedDB === 'undefined'
    ? localStorageStore()
    : migratingStore(indexedDbStore(indexedDB), localStorageStore(), () => {
        try {
          localStorage.removeItem(WEB_ASSISTANTS_STORAGE_KEY)
        } catch {
          // Storage blocked: the old copy just stays
        }
      })

export class WebAssistantsService implements AssistantsService {
  // Saves run one at a time so quick edits don't overwrite each other
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private store: AssistantStore = defaultStore()) {}

  // Starts with the built-in assistant, like the desktop app's assistant
  // folder. The built-in one saved under its old name "Jan" reads as Hi-chat.
  private async read(): Promise<Assistant[]> {
    const saved = await this.store.get()
    if (!saved) return [defaultAssistant as unknown as Assistant]
    return saved.map((a) =>
      a.id === defaultAssistant.id && a.name === 'Jan'
        ? { ...a, name: defaultAssistant.name }
        : a
    )
  }

  private change(edit: (assistants: Assistant[]) => Assistant[]) {
    const next = this.queue.then(async () =>
      this.store.set(edit(await this.read()))
    )
    this.queue = next.catch(() => {})
    return next
  }

  async getAssistants(): Promise<Assistant[] | null> {
    await this.queue
    const assistants = await this.read()
    return assistants.length > 0 ? assistants : null
  }

  // Creates the assistant, or replaces the one with the same id
  async createAssistant(assistant: Assistant): Promise<void> {
    await this.change((assistants) => {
      const index = assistants.findIndex((a) => a.id === assistant.id)
      if (index >= 0) assistants[index] = assistant
      else assistants.push(assistant)
      return assistants
    })
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    await this.change((assistants) =>
      assistants.filter((a) => a.id !== assistant?.id)
    )
  }
}
