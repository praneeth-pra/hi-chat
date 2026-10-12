import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessages } from '../useMessages'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  modify: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    messages: () => ({
      createMessage: mocks.create,
      modifyMessage: mocks.modify,
      deleteMessage: mocks.remove,
    }),
  }),
}))
vi.mock('../useThreadHygiene', () => ({
  noteMessageAdded: vi.fn(),
  noteMessageDeleted: vi.fn(),
}))
vi.mock('../useAssistant', () => ({
  useAssistant: {
    getState: () => ({
      assistants: [
        {
          id: 'a',
          name: 'Assistant',
          documents: [{ name: 'resume', text: 'Private background' }],
        },
      ],
      currentAssistant: null,
    }),
  },
}))

describe('pending message persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMessages.setState({ messages: {} })
  })
  const message = {
    id: 'm',
    thread_id: 't',
    role: 'user',
    content: [{ type: 'text', text: { value: 'Original' } }],
  } as any

  it('does not replace newer edits with an earlier create result', async () => {
    let finish!: (value: any) => void
    mocks.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    useMessages.getState().addMessage(message)
    const edited = {
      ...message,
      content: [{ type: 'text', text: { value: 'Edited' } }],
    }
    useMessages.getState().updateMessage(edited)
    finish(message)
    await Promise.resolve()
    expect(useMessages.getState().getMessages('t')[0].content).toEqual(
      edited.content
    )
  })

  it('does not restore cleared chat state when a save finishes', async () => {
    let finish!: (value: any) => void
    mocks.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    useMessages.getState().addMessage(message)
    useMessages.getState().clearAllMessages()
    finish(message)
    await Promise.resolve()
    expect(useMessages.getState().messages).toEqual({})
  })

  it('does not duplicate full assistant documents in every saved message', async () => {
    mocks.create.mockImplementation(async (value) => value)
    useMessages.getState().addMessage(message)
    expect(mocks.create.mock.calls[0][0].metadata.assistant).toEqual({
      id: 'a',
      name: 'Assistant',
    })
    useMessages.getState().updateMessage(message)
    expect(mocks.modify.mock.calls[0][0].metadata.assistant).not.toHaveProperty(
      'documents'
    )
    await Promise.resolve()
  })
})
