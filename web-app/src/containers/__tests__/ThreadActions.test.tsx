import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThreadActions } from '../ThreadActions'

const mocks = vi.hoisted(() => ({
  deleteThread: vi.fn(),
  navigate: vi.fn(),
  abort: vi.fn(),
  activeId: 'chat',
  extract: vi.fn(),
  messages: [
    { role: 'user', content: [{ type: 'text', text: { value: 'Why ECS?' } }] },
  ],
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useMatches: () => [{ params: { threadId: mocks.activeId } }],
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: (selector: any) => selector({ deleteThread: mocks.deleteThread }),
}))
vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () => ({ abortControllers: { chat: { abort: mocks.abort } } }),
  },
}))
vi.mock('@/hooks/useMessages', () => ({
  useMessages: Object.assign(
    (selector: any) => selector({ messages: { chat: mocks.messages } }),
    { getState: () => ({ getMessages: () => mocks.messages }) }
  ),
}))
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: { getState: () => ({ providers: [] }) },
}))
vi.mock('@/lib/chatQuestions', () => ({
  collectChatPrompts: () => [{ promptIndex: 1, text: 'Why ECS?' }],
  extractChatQuestions: mocks.extract,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const thread = { id: 'chat', title: 'AWS interview' } as Thread

describe('chat actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activeId = 'chat'
    mocks.extract.mockResolvedValue([{ promptIndex: 1, text: 'Why ECS?' }])
  })
  it('asks for confirmation and cancels without deleting', async () => {
    const user = userEvent.setup()
    render(<ThreadActions thread={thread} />)
    await user.click(screen.getByRole('button', { name: 'Delete this chat' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(mocks.deleteThread).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common:cancel' }))
    expect(mocks.deleteThread).not.toHaveBeenCalled()
  })
  it('Enter deletes the active chat once and stops its generation', async () => {
    const user = userEvent.setup()
    render(<ThreadActions thread={thread} />)
    await user.click(screen.getByRole('button', { name: 'Delete this chat' }))
    await user.keyboard('{Enter}')
    expect(mocks.deleteThread).toHaveBeenCalledExactlyOnceWith('chat')
    expect(mocks.abort).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1))
  })
  it('keeps the active page when another chat is deleted', async () => {
    mocks.activeId = 'different-chat'
    const user = userEvent.setup()
    render(<ThreadActions thread={thread} />)
    await user.click(screen.getByRole('button', { name: 'Delete this chat' }))
    await user.click(
      screen.getByRole('button', { name: 'common:delete AWS interview' })
    )
    expect(mocks.deleteThread).toHaveBeenCalledExactlyOnceWith('chat')
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
  it('runs question extraction only when requested and displays the result separately', async () => {
    const user = userEvent.setup()
    render(<ThreadActions thread={thread} />)
    await user.click(
      screen.getByRole('button', { name: 'Questions in this chat' })
    )
    expect(mocks.extract).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Extract questions' }))
    expect(await screen.findByText('Why ECS?')).toBeTruthy()
    expect(mocks.extract).toHaveBeenCalledTimes(1)
    expect(mocks.deleteThread).not.toHaveBeenCalled()
  })
  it('aborts question extraction when its dialog is closed', async () => {
    let signal: AbortSignal | undefined
    mocks.extract.mockImplementation(
      (_thread, _prompts, _providers, requestSignal) => {
        signal = requestSignal
        return new Promise(() => {})
      }
    )
    const user = userEvent.setup()
    render(<ThreadActions thread={thread} />)
    await user.click(
      screen.getByRole('button', { name: 'Questions in this chat' })
    )
    await user.click(screen.getByRole('button', { name: 'Extract questions' }))
    await user.keyboard('{Escape}')
    expect(signal?.aborted).toBe(true)
  })
})
