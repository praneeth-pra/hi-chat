import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StreamingContent } from '../StreamingContent'
const state = vi.hoisted(() => ({
  accuracyStatus: undefined as { threadId: string; phase: string } | undefined,
  streamingContent: undefined as any,
  messages: [] as any[],
}))
vi.mock('@/hooks/useAppState', () => ({
  useAppState: (selector: any) => selector(state),
}))
vi.mock('@/hooks/useMessages', () => ({
  useMessages: (selector: any) =>
    selector({ messages: { chat: state.messages } }),
}))
vi.mock('../ThreadContent', () => ({
  ThreadContent: ({ content }: any) => <div>{content[0].text.value}</div>,
}))

describe('Accuracy progress visibility', () => {
  beforeEach(() => {
    state.messages = []
    state.accuracyStatus = undefined
    state.streamingContent = undefined
  })
  it('shows search progress before a draft or stream exists', () => {
    state.accuracyStatus = { threadId: 'chat', phase: 'searching' }
    state.streamingContent = undefined
    render(<StreamingContent threadId="chat" />)
    expect(screen.getByRole('status').textContent).toContain(
      'searching sources'
    )
  })
  it('shows review progress before the stream is initialized and hides unchecked text', () => {
    state.accuracyStatus = { threadId: 'chat', phase: 'verifying' }
    state.streamingContent = { thread_id: '', content: [] }
    const { rerender } = render(<StreamingContent threadId="chat" />)
    expect(screen.getByRole('status').textContent).toContain('checking')
    state.streamingContent = {
      thread_id: 'chat',
      content: [{ type: 'text', text: { value: 'Unchecked draft' } }],
    }
    rerender(<StreamingContent threadId="chat" />)
    expect(screen.queryByText('Unchecked draft')).toBeNull()
  })
  it('does not display another chat’s review status or draft', () => {
    state.accuracyStatus = { threadId: 'other-chat', phase: 'verifying' }
    state.streamingContent = {
      thread_id: 'other-chat',
      content: [{ type: 'text', text: { value: 'Other chat' } }],
    }
    const { container } = render(<StreamingContent threadId="chat" />)
    expect(container.textContent).toBe('')
  })
})

it('shows a fresh stream after stopping the previous answer', () => {
  state.accuracyStatus = undefined
  state.messages = [{ id: 'old', role: 'assistant', status: 'stopped' }]
  state.streamingContent = {
    id: 'new',
    thread_id: 'chat',
    content: [{ type: 'text', text: { value: 'New answer' } }],
  }
  render(<StreamingContent threadId="chat" />)
  expect(screen.getByText('New answer')).toBeTruthy()
})
