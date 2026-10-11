import { describe, expect, it } from 'vitest'
import type { ThreadMessage } from '@janhq/core'
import { speakerQuestionTarget } from '../speakerTurnDelivery'
const message = (id: string, role: string, text: string, metadata = {}) =>
  ({
    id,
    role,
    thread_id: 'thread',
    content: [{ type: 'text', text: { value: text, annotations: [] } }],
    metadata,
  }) as ThreadMessage

describe('speaker update ownership', () => {
  it('targets the existing question and answer without deleting either', () => {
    const old = message('old', 'user', 'Earlier topic')
    const question = message('q', 'user', 'How does DNS work?', {
      speakerTurnId: 'dns',
    })
    const answer = message('a', 'assistant', 'Existing answer')
    expect(speakerQuestionTarget([old, question, answer], 'dns')).toEqual({
      user: question,
      answer,
      context: [old],
    })
  })
  it('does not overwrite a typed question that intervened', () => {
    expect(
      speakerQuestionTarget(
        [
          message('q', 'user', 'DNS?', { speakerTurnId: 'dns' }),
          message('typed', 'user', 'New typed question'),
        ],
        'dns'
      )
    ).toBeNull()
  })
  it('does not treat a tool call as the answer to replace', () => {
    const q = message('q', 'user', 'DNS?', { speakerTurnId: 'dns' })
    expect(
      speakerQuestionTarget(
        [q, message('tool', 'assistant', '', { tool_calls: [{}] })],
        'dns'
      )?.answer
    ).toBeUndefined()
  })
})
