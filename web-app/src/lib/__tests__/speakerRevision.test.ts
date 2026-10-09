import { describe, it, expect } from 'vitest'
import { replaceableQuestion } from '../speakerRevision'
import { useSpeakerTranscription } from '@/hooks/useSpeakerTranscription'

const msg = (id: string, role: 'user' | 'assistant', text: string) =>
  ({
    id,
    role,
    thread_id: 't',
    content: [{ type: 'text', text: { value: text, annotations: [] } }],
  }) as unknown as ThreadMessage

describe('replaceableQuestion', () => {
  const q = 'How will you extract the token?'

  it('removes the last speaker question and its answer', () => {
    const messages = [
      msg('1', 'user', 'What is a pod?'),
      msg('2', 'assistant', 'A pod is...'),
      msg('3', 'user', q),
      msg('4', 'assistant', 'Use a JSON extractor...'),
    ]
    expect(replaceableQuestion(messages, q)).toEqual(['3', '4'])
  })

  it('removes the question while its answer is still streaming', () => {
    expect(replaceableQuestion([msg('3', 'user', q)], q)).toEqual(['3'])
  })

  it('leaves the chat alone once something else was sent', () => {
    const messages = [msg('3', 'user', q), msg('5', 'user', 'typed by me')]
    expect(replaceableQuestion(messages, q)).toBeNull()
    expect(replaceableQuestion([], q)).toBeNull()
    expect(replaceableQuestion([msg('3', 'user', q)], null)).toBeNull()
  })
})

describe('useSpeakerTranscription.revise', () => {
  it('replaces a question still waiting in the queue', () => {
    const s = useSpeakerTranscription.getState()
    s.enqueue('How will you extract the token?')
    s.revise('How will you extract the token? It could be a bearer token.')
    expect(useSpeakerTranscription.getState().queue).toEqual([
      'How will you extract the token? It could be a bearer token.',
    ])
    expect(useSpeakerTranscription.getState().revision).toBeNull()
    s.dequeue()
  })

  it('asks the chat to replace a question already sent', () => {
    const s = useSpeakerTranscription.getState()
    s.revise('Fuller question')
    expect(useSpeakerTranscription.getState().takeRevision()).toBe(
      'Fuller question'
    )
    expect(useSpeakerTranscription.getState().revision).toBeNull()
  })
})
