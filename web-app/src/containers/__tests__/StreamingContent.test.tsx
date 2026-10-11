import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StreamingContent } from '../StreamingContent'
const state = vi.hoisted(() => ({
  accuracyStatus: undefined as { threadId: string; phase: string } | undefined,
  streamingContent: undefined as any,
}))
vi.mock('@/hooks/useAppState', () => ({
  useAppState: (selector: any) => selector(state),
}))
vi.mock('@/hooks/useMessages', () => ({
  useMessages: () => ({ getMessages: () => [] }),
}))
vi.mock('../ThreadContent', () => ({
  ThreadContent: ({ content }: any) => <div>{content[0].text.value}</div>,
}))

describe('Accuracy progress visibility', () => {
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
