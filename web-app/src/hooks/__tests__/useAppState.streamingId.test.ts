import { describe, it, expect, vi } from 'vitest'

vi.mock('../useAssistant', () => ({
  useAssistant: {
    getState: () => ({ assistants: [], currentAssistant: undefined }),
  },
}))

import { useAppState } from '../useAppState'
import { emptyThreadContent, newAssistantThreadContent } from '@/lib/completion'

describe('streaming answer id', () => {
  it('stays the same for the whole answer, and is new for the next one', () => {
    const { updateStreamingContent } = useAppState.getState()
    updateStreamingContent(emptyThreadContent)
    updateStreamingContent(newAssistantThreadContent('t1', 'Hel'))
    const first = useAppState.getState().streamingContent!.id
    updateStreamingContent(newAssistantThreadContent('t1', 'Hello'))
    expect(useAppState.getState().streamingContent!.id).toBe(first)
    expect(
      useAppState.getState().streamingContent!.content[0].text!.value
    ).toBe('Hello')
    // Finished: the next answer starts over with its own id
    updateStreamingContent(emptyThreadContent)
    updateStreamingContent(newAssistantThreadContent('t1', 'Next'))
    expect(useAppState.getState().streamingContent!.id).not.toBe(first)
  })
})
