import { beforeEach, describe, expect, it } from 'vitest'
import {
  setQuestionControls,
  useSpeakerTranscription,
} from '../useSpeakerTranscription'
const question = {
  id: 'question',
  version: 1,
  text: 'How does DNS work?',
  relation: 'new' as const,
}
beforeEach(() => {
  useSpeakerTranscription.getState().resetTurns()
  useSpeakerTranscription.getState().setEnabled(true)
})
describe('speaker turn delivery state', () => {
  it('coalesces pending revisions without adding another prompt', () => {
    const store = useSpeakerTranscription.getState()
    store.queueTurn(question, 'thread')
    store.queueTurn(
      {
        ...question,
        version: 2,
        text: 'How does DNS work? And caching?',
        relation: 'update',
      },
      'thread'
    )
    expect(useSpeakerTranscription.getState().turnQueue).toHaveLength(1)
    expect(useSpeakerTranscription.getState().takeTurn()).toMatchObject({
      version: 2,
      threadId: 'thread',
    })
  })
  it('disabling clears drafts, queues, revisions and suggestions and revokes delivery', () => {
    const store = useSpeakerTranscription.getState()
    store.queueTurn(question, 'thread')
    store.enqueue('legacy')
    store.suggest('Maybe?')
    store.setPendingQuestion({
      id: 'pending',
      text: 'Suppose three services.',
      complete: false,
      manual: false,
      reason: 'scenario',
    })
    const running = store.takeTurn()!
    store.setEnabled(false)
    expect(useSpeakerTranscription.getState()).toMatchObject({
      turnQueue: [],
      queue: [],
      revision: null,
      pendingQuestion: null,
      suggestions: [],
      sendingTurn: null,
    })
    expect(useSpeakerTranscription.getState().deliveryEpoch).toBeGreaterThan(
      running.epoch
    )
  })
  it('late completion cannot clear a newer delivery', () => {
    const store = useSpeakerTranscription.getState()
    store.queueTurn(question)
    const first = store.takeTurn()!
    store.queueTurn({ ...question, version: 2 })
    const second = store.takeTurn()!
    store.finishTurn(first)
    expect(useSpeakerTranscription.getState().sendingTurn).toBe(second)
  })
  it('routes manual controls through the coordinator', () => {
    let sends = 0,
      holds = 0,
      discards = 0
    const cleanup = setQuestionControls({
      sendNow: () => {
        sends++
      },
      keepListening: () => {
        holds++
      },
      discard: () => {
        discards++
      },
    })
    const store = useSpeakerTranscription.getState()
    store.sendPendingQuestion()
    store.keepListening()
    store.discardPendingQuestion()
    expect([sends, holds, discards]).toEqual([1, 1, 1])
    cleanup()
  })
  it('bounds suggestion reasons and removes them with their suggestions', () => {
    const store = useSpeakerTranscription.getState()
    for (let i = 0; i < 5; i++) store.suggest(`question ${i}`, `reason ${i}`)
    expect(
      Object.keys(useSpeakerTranscription.getState().suggestionReasons)
    ).toHaveLength(1)
    store.dismissSuggestion('question 4')
    expect(
      useSpeakerTranscription.getState().suggestionReasons['question 4']
    ).toBeUndefined()
    store.resetTurns()
    expect(useSpeakerTranscription.getState().suggestionReasons).toEqual({})
  })
})
