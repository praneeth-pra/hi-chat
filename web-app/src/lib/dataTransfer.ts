/**
 * Moves everything Hi-chat keeps in this browser (chats, API keys, settings)
 * to another browser or the Hi-chat Mac app: export to a file here, import
 * it there. Each browser and app keeps its own storage, so nothing is shared
 * on its own.
 */

export const DATA_FILE_KIND = 'hi-chat-data'

type StoreDump = {
  name: string
  keyPath: string | string[] | null
  autoIncrement: boolean
  indexes: {
    name: string
    keyPath: string | string[]
    unique: boolean
    multiEntry: boolean
  }[]
  /** Keys only for stores without a key path */
  keys?: IDBValidKey[]
  values: unknown[]
}

type DatabaseDump = { name: string; stores: StoreDump[] }

export type DataFile = {
  kind: typeof DATA_FILE_KIND
  version: 1
  exportedAt: string
  localStorage: Record<string, string>
  databases: DatabaseDump[]
}

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

function openDatabase(
  factory: IDBFactory,
  name: string,
  version?: number,
  upgrade?: (db: IDBDatabase, tx: IDBTransaction) => void
) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req =
      version === undefined ? factory.open(name) : factory.open(name, version)
    req.onupgradeneeded = () => upgrade?.(req.result, req.transaction!)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () =>
      reject(new Error('Close Hi-chat in other tabs and windows, then retry'))
  })
}

export function readLocalStorage(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key !== null) out[key] = storage.getItem(key) ?? ''
  }
  return out
}

async function dumpDatabase(
  factory: IDBFactory,
  name: string
): Promise<DatabaseDump> {
  const db = await openDatabase(factory, name)
  try {
    const stores: StoreDump[] = []
    for (const storeName of Array.from(db.objectStoreNames)) {
      const store = db.transaction(storeName, 'readonly').objectStore(storeName)
      const indexes = Array.from(store.indexNames).map((n) => {
        const index = store.index(n)
        return {
          name: n,
          keyPath: index.keyPath,
          unique: index.unique,
          multiEntry: index.multiEntry,
        }
      })
      const values = await request(store.getAll())
      const keys =
        store.keyPath === null ? await request(store.getAllKeys()) : undefined
      stores.push({
        name: storeName,
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        indexes,
        ...(keys ? { keys } : {}),
        values,
      })
    }
    return { name, stores }
  } finally {
    db.close()
  }
}

export async function exportData(
  storage: Storage = localStorage,
  factory: IDBFactory = indexedDB
): Promise<DataFile> {
  const names = factory.databases
    ? (await factory.databases()).flatMap((d) => (d.name ? [d.name] : []))
    : ['jan-web']
  const databases: DatabaseDump[] = []
  for (const name of names) databases.push(await dumpDatabase(factory, name))
  return {
    kind: DATA_FILE_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    localStorage: readLocalStorage(storage),
    databases,
  }
}

export function parseDataFile(text: string): DataFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This is not a Hi-chat data file')
  }
  const file = data as Partial<DataFile>
  if (
    file?.kind !== DATA_FILE_KIND ||
    typeof file.localStorage !== 'object' ||
    !Array.isArray(file.databases)
  )
    throw new Error('This is not a Hi-chat data file')
  return file as DataFile
}

async function restoreDatabase(factory: IDBFactory, dump: DatabaseDump) {
  let db = await openDatabase(factory, dump.name)
  const missing = dump.stores.filter(
    (s) => !db.objectStoreNames.contains(s.name)
  )
  if (missing.length) {
    const version = db.version + 1
    db.close()
    db = await openDatabase(factory, dump.name, version, (upgraded) => {
      for (const s of missing) {
        const store = upgraded.createObjectStore(s.name, {
          keyPath: s.keyPath ?? undefined,
          autoIncrement: s.autoIncrement,
        })
        for (const i of s.indexes)
          store.createIndex(i.name, i.keyPath, {
            unique: i.unique,
            multiEntry: i.multiEntry,
          })
      }
    })
  }
  try {
    for (const s of dump.stores) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(s.name, 'readwrite')
        const store = tx.objectStore(s.name)
        s.values.forEach((value, i) => {
          if (store.keyPath === null) store.put(value, s.keys?.[i])
          else store.put(value)
        })
        tx.oncomplete = () => resolve()
        tx.onabort = () => reject(tx.error ?? new Error('Import was aborted'))
      })
    }
  } finally {
    db.close()
  }
}

/** Adds the file's chats and settings to this browser; same ids are replaced. */
export async function importData(
  file: DataFile,
  storage: Storage = localStorage,
  factory: IDBFactory = indexedDB
): Promise<{ chats: number }> {
  for (const dump of file.databases) await restoreDatabase(factory, dump)
  for (const [key, value] of Object.entries(file.localStorage))
    storage.setItem(key, value)
  const threads = file.databases
    .flatMap((d) => d.stores)
    .find((s) => s.name === 'threads')
  return { chats: threads?.values.length ?? 0 }
}

export function dataFileName(now = new Date()) {
  return `hi-chat-data-${now.toISOString().slice(0, 10)}.json`
}
