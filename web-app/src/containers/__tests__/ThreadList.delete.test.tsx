import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThreadList from '../ThreadList'

const mocks = vi.hoisted(() => ({
  deleteThread: vi.fn(),
  navigate: vi.fn(),
  abortChat: vi.fn(),
  abortOther: vi.fn(),
  activeId: 'chat',
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useMatches: () => [
    { routeId: '/threads/$threadId', params: { threadId: mocks.activeId } },
  ],
}))
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useThreads', () => ({
  useThreads: (selector: any) => selector({ deleteThread: mocks.deleteThread }),
}))
vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () => ({
      abortControllers: {
        chat: { abort: mocks.abortChat },
        other: { abort: mocks.abortOther },
      },
    }),
  },
}))
vi.mock('@/hooks/useMessages', () => ({
  useMessages: (selector: any) => selector({ getMessages: () => [] }),
}))
vi.mock('@/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({ folders: [], getFolderById: vi.fn() }),
  useThreadManagementStore: (selector: any) =>
    selector({ folders: [], getFolderById: vi.fn() }),
}))
vi.mock('@/containers/dialogs', async () => ({
  RenameThreadDialog: () => null,
  DeleteThreadDialog: (await import('../dialogs/DeleteThreadDialog'))
    .DeleteThreadDialog,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
const thread = {
  id: 'chat',
  title: 'AWS interview',
  updated: Date.now(),
} as Thread

describe('sidebar chat deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activeId = 'chat'
  })
  it('deletes the active chat directly, stops only its answer, and returns home', async () => {
    const user = userEvent.setup()
    render(<ThreadList threads={[thread]} />)
    await user.click(
      screen.getByRole('button', { name: 'common:delete AWS interview' })
    )
    expect(mocks.deleteThread).toHaveBeenCalledExactlyOnceWith('chat')
    expect(mocks.abortChat).toHaveBeenCalledTimes(1)
    expect(mocks.abortOther).not.toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({ to: '/' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('deletes another chat without navigating or stopping the active answer', async () => {
    mocks.activeId = 'other'
    const user = userEvent.setup()
    render(<ThreadList threads={[thread]} />)
    await user.click(
      screen.getByRole('button', { name: 'common:delete AWS interview' })
    )
    expect(mocks.deleteThread).toHaveBeenCalledExactlyOnceWith('chat')
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.abortOther).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('keyboard activation deletes once without opening confirmation', async () => {
    const user = userEvent.setup()
    render(<ThreadList threads={[thread]} />)
    screen.getByRole('button', { name: 'common:delete AWS interview' }).focus()
    await user.keyboard('{Enter}')
    expect(mocks.deleteThread).toHaveBeenCalledExactlyOnceWith('chat')
    expect(mocks.navigate).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('the sidebar menu also deletes directly without opening the clicked chat', async () => {
    mocks.activeId = 'other'
    const user = userEvent.setup()
    render(<ThreadList threads={[thread]} />)
    fireEvent.contextMenu(screen.getByText('AWS interview'))
    await user.click(screen.getByRole('menuitem', { name: 'common:delete' }))
    expect(mocks.deleteThread).toHaveBeenCalledExactlyOnceWith('chat')
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('keeps the project-page confirmation path', async () => {
    const user = userEvent.setup()
    render(<ThreadList threads={[thread]} variant="project" />)
    await user.click(
      screen.getByRole('button', { name: 'common:delete AWS interview' })
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(mocks.deleteThread).not.toHaveBeenCalled()
    expect(mocks.abortChat).not.toHaveBeenCalled()
  })
})
