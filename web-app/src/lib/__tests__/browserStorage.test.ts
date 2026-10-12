import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let tx: any
let db: any
let open: any
beforeEach(() => {
  vi.resetModules()
  const store = {
    put: vi.fn(),
    delete: vi.fn(),
    index: () => ({ openCursor: () => ({}) }),
  }
  tx = { objectStore: () => store, abort: vi.fn(), error: null }
  db = { transaction: vi.fn(() => tx), close: vi.fn() }
  open = {}
  vi.stubGlobal('indexedDB', { open: () => open })
  vi.stubGlobal('IDBKeyRange', { only: (value: string) => value })
})
afterEach(() => vi.unstubAllGlobals())
const storage = () =>
  import('../../../../extensions-web/src/conversational-web/db')
async function opened() {
  open.result = db
  open.onsuccess()
  await Promise.resolve()
  await Promise.resolve()
}

it('acknowledges writes only after the transaction commits', async () => {
  const { put } = await storage()
  let complete = false
  const pending = put('messages', { id: 'm' }).then(() => {
    complete = true
  })
  await opened()
  expect(complete).toBe(false)
  tx.oncomplete()
  await pending
  expect(complete).toBe(true)
})

it('reports a late transaction abort rather than a successful save', async () => {
  const { put } = await storage()
  const pending = put('messages', { id: 'm' })
  const assertion = expect(pending).rejects.toThrow('Quota exceeded')
  await opened()
  tx.error = new Error('Quota exceeded')
  tx.onabort()
  await assertion
})

it('deletes the thread and its messages in the same transaction', async () => {
  const { removeThread } = await storage()
  const pending = removeThread('t')
  await opened()
  expect(db.transaction).toHaveBeenCalledWith(
    ['threads', 'messages'],
    'readwrite'
  )
  expect(tx.objectStore().delete).toHaveBeenCalledWith('t')
  tx.oncomplete()
  await pending
})

it('closes obsolete connections so another tab can upgrade the database', async () => {
  const { put } = await storage()
  const pending = put('messages', { id: 'm' })
  await opened()
  tx.oncomplete()
  await pending
  db.onversionchange()
  expect(db.close).toHaveBeenCalledOnce()
})
