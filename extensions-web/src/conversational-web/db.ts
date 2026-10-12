/**
 * Minimal IndexedDB wrapper for storing threads and messages in the browser.
 */

const DB_NAME = 'jan-web'
const DB_VERSION = 1

export const STORES = {
  threads: 'threads',
  messages: 'messages',
} as const

type StoreName = (typeof STORES)[keyof typeof STORES]

let dbPromise: Promise<IDBDatabase> | undefined

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORES.threads)) {
          db.createObjectStore(STORES.threads, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(STORES.messages)) {
          const messages = db.createObjectStore(STORES.messages, {
            keyPath: 'id',
          })
          messages.createIndex('thread_id', 'thread_id', { unique: false })
        }
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          dbPromise = undefined
        }
        db.onclose = () => {
          dbPromise = undefined
        }
        resolve(db)
      }
      request.onerror = () => {
        dbPromise = undefined
        reject(request.error)
      }
    })
  }
  return dbPromise
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function store(name: StoreName, mode: IDBTransactionMode) {
  const db = await openDb()
  return db.transaction(name, mode).objectStore(name)
}

// IndexedDB can only store structured-cloneable data, so drop anything else
// (functions, class instances) that may hang off app objects.
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

export async function getAll<T>(name: StoreName): Promise<T[]> {
  return promisify((await store(name, 'readonly')).getAll()) as Promise<T[]>
}

export async function get<T>(
  name: StoreName,
  key: string
): Promise<T | undefined> {
  return promisify((await store(name, 'readonly')).get(key)) as Promise<
    T | undefined
  >
}

export async function put<T>(name: StoreName, value: T): Promise<void> {
  const data = plain(value)
  await write([name], (tx) => {
    tx.objectStore(name).put(data)
  })
}

export async function remove(name: StoreName, key: string): Promise<void> {
  await write([name], (tx) => {
    tx.objectStore(name).delete(key)
  })
}

/** Request success precedes commit; a later quota/transaction abort must fail the save. */
async function write(
  names: StoreName[],
  enqueue: (tx: IDBTransaction) => void
): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onabort = () =>
      reject(tx.error ?? new Error('Chat storage transaction aborted'))
    try {
      enqueue(tx)
    } catch (error) {
      tx.abort()
      reject(error)
    }
  })
}

export async function getByThread<T>(threadId: string): Promise<T[]> {
  const messages = await store(STORES.messages, 'readonly')
  return promisify(
    messages.index('thread_id').getAll(IDBKeyRange.only(threadId))
  ) as Promise<T[]>
}

export async function removeByThread(threadId: string): Promise<void> {
  await write([STORES.messages], (tx) => deleteMessages(tx, threadId))
}

function deleteMessages(tx: IDBTransaction, threadId: string) {
  const request = tx
    .objectStore(STORES.messages)
    .index('thread_id')
    .openCursor(IDBKeyRange.only(threadId))
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    cursor.delete()
    cursor.continue()
  }
}

/** Remove the chat and its messages in a single commit, without loading message bodies. */
export async function removeThread(threadId: string): Promise<void> {
  await write([STORES.threads, STORES.messages], (tx) => {
    tx.objectStore(STORES.threads).delete(threadId)
    deleteMessages(tx, threadId)
  })
}
