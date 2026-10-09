import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ThreadMessage } from '@janhq/core'

const fetchMessages = vi.fn()
const deleteThread = vi.fn()
const updateThread = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    messages: () => ({
      fetchMessages,
      createMessage: vi.fn((m) => Promise.resolve(m)),
      deleteMessage: vi.fn(),
    }),
    threads: () => ({ deleteThread, updateThread }),
    path: () => ({ sep: () => '/' }),
  }),
}))

import { useThreads } from '../useThreads'
import { useMessages } from '../useMessages'
import {
  deleteIfEmpty,
  noteMessageAdded,
  tidyThreads,
} from '../useThreadHygiene'

const DAY = 24 * 60 * 60

const thread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 't1',
  title: 'New Thread',
  updated: Date.now() / 1000 - DAY,
  ...overrides,
})

const message = (
  text: string,
  role: 'user' | 'assistant' = 'user',
  threadId = 't1'
) =>
  ({
    id: `${threadId}-${role}-${text}`,
    thread_id: threadId,
    role,
    content: [{ type: 'text', text: { value: text, annotations: [] } }],
    created_at: Date.now(),
  }) as unknown as ThreadMessage

const setThreads = (list: Thread[]) =>
  useThreads.setState({
    threads: Object.fromEntries(list.map((t) => [t.id, t])),
    currentThreadId: undefined,
  })

describe('useThreadHygiene', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMessages.mockResolvedValue([])
    useMessages.setState({ messages: {} })
    window.history.replaceState(null, '', '/')
  })

  describe('noteMessageAdded', () => {
    it('names a placeholder chat after the first user message', () => {
      setThreads([thread({ metadata: { message_count: 0 } })])
      noteMessageAdded(message('  How do I bake\nsourdough bread?  '))
      const t = useThreads.getState().threads.t1
      expect(t.title).toBe('How do I bake sourdough bread?')
      expect(t.metadata?.message_count).toBe(1)
    })

    it('does not rename chats the user renamed', () => {
      setThreads([
        thread({ metadata: { message_count: 0, title_edited: true } }),
      ])
      noteMessageAdded(message('What is RAG?'))
      expect(useThreads.getState().threads.t1.title).toBe('New Thread')
    })

    it('keeps an existing real title', () => {
      setThreads([
        thread({ title: 'Trip plans', metadata: { message_count: 2 } }),
      ])
      noteMessageAdded(message('And hotels?'))
      const t = useThreads.getState().threads.t1
      expect(t.title).toBe('Trip plans')
      expect(t.metadata?.message_count).toBe(3)
    })

    it('does not move the chat in the list', () => {
      const original = thread({ metadata: { message_count: 0 } })
      setThreads([original])
      noteMessageAdded(message('What is RAG?'))
      expect(useThreads.getState().threads.t1.updated).toBe(original.updated)
    })
  })

  describe('renameThread', () => {
    it('marks the title as user edited', () => {
      setThreads([thread()])
      useThreads.getState().renameThread('t1', 'Mine')
      expect(useThreads.getState().threads.t1.metadata?.title_edited).toBe(true)
    })
  })

  describe('deleteIfEmpty', () => {
    it('deletes a chat with no messages', async () => {
      setThreads([thread()])
      expect(await deleteIfEmpty('t1')).toBe(true)
      expect(useThreads.getState().threads.t1).toBeUndefined()
      expect(deleteThread).toHaveBeenCalledWith('t1')
    })

    it('never deletes a chat with stored messages', async () => {
      setThreads([thread({ metadata: { message_count: 0 } })])
      fetchMessages.mockResolvedValue([message('hi')])
      expect(await deleteIfEmpty('t1')).toBe(false)
      expect(useThreads.getState().threads.t1).toBeDefined()
      expect(useThreads.getState().threads.t1.metadata?.message_count).toBe(1)
    })

    it('never deletes a chat with messages in memory', async () => {
      setThreads([thread()])
      useMessages.setState({ messages: { t1: [message('hi')] } })
      expect(await deleteIfEmpty('t1')).toBe(false)
      expect(fetchMessages).not.toHaveBeenCalled()
    })

    it('keeps the open chat and starred chats', async () => {
      setThreads([thread(), thread({ id: 't2', isFavorite: true })])
      useThreads.setState({ currentThreadId: 't1' })
      expect(await deleteIfEmpty('t1')).toBe(false)
      expect(await deleteIfEmpty('t2')).toBe(false)
    })

    it('keeps the chat open in the URL before the route sets it', async () => {
      setThreads([thread()])
      window.history.replaceState(null, '', '/threads/t1')
      expect(await deleteIfEmpty('t1')).toBe(false)
    })
  })

  describe('tidyThreads', () => {
    it('fills counts and titles, and removes empty chats', async () => {
      setThreads([
        thread({ id: 'a' }),
        thread({ id: 'b', title: '' }),
        thread({ id: 'c', title: 'Renamed', metadata: { title_edited: true } }),
        thread({ id: 'd', title: 'Counted', metadata: { message_count: 4 } }),
      ])
      fetchMessages.mockImplementation(async (id: string) => {
        if (id === 'a')
          return [
            message('Plan a week in Japan', 'user', 'a'),
            message('Sure', 'assistant', 'a'),
          ]
        if (id === 'c') return [message('rgawerg', 'user', 'c')]
        return []
      })

      await tidyThreads()

      const { threads } = useThreads.getState()
      expect(threads.a.title).toBe('Plan a week in Japan')
      expect(threads.a.metadata?.message_count).toBe(2)
      expect(threads.b).toBeUndefined()
      expect(threads.c.title).toBe('Renamed')
      expect(threads.c.metadata?.message_count).toBe(1)
      // Chats that already have a count are not read again
      expect(fetchMessages).not.toHaveBeenCalledWith('d')
    })
  })
})
