import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQuestionTurns, type QuestionDraft } from '../speakerTurns'
import type { TurnDecision } from '../speakerTurnJudge'
const decision = (
  action: TurnDecision['action'],
  text: string,
  complete = false
): TurnDecision => ({ action, text, complete, reason: 'test' })
const listeners: ReturnType<typeof createQuestionTurns>[] = []
function setup() {
  const judge =
    vi.fn<(texts: string[], context: unknown) => Promise<TurnDecision>>()
  const onCommit = vi.fn(),
    onSuggest = vi.fn(),
    onDraft = vi.fn<(draft: QuestionDraft | null) => void>()
  const turns = createQuestionTurns({ judge, onCommit, onSuggest, onDraft })
  listeners.push(turns)
  return { turns, judge, onCommit, onSuggest, onDraft }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  listeners.splice(0).forEach((t) => t.stop())
  vi.useRealTimers()
})
describe('approval-only speaker turns', () => {
  it('never sends the first complete question on silence or capture activity', async () => {
    const { turns, judge, onCommit, onDraft } = setup()
    judge.mockResolvedValue(decision('question', 'How does DNS work?', true))
    turns.audioActivity(true)
    turns.activity(true)
    await turns.accept(['How does DNS work?'])
    turns.audioActivity(false)
    turns.activity(false)
    await vi.advanceTimersByTimeAsync(120000)
    expect(onCommit).not.toHaveBeenCalled()
    expect(onDraft.mock.calls.at(-1)![0]).toMatchObject({
      complete: true,
      requiresReview: true,
    })
    expect(turns.sendNow()).toBe(true)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit.mock.calls[0][0]).toMatchObject({
      text: 'How does DNS work?',
      origin: 'send-now',
      relation: 'new',
      version: 1,
    })
    turns.activity(true)
    await vi.advanceTimersByTimeAsync(10000)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('accumulates a scenario across long gaps and waits for approval after completion', async () => {
    const { turns, judge, onCommit } = setup()
    judge
      .mockResolvedValueOnce(
        decision('context', 'Suppose we have three services.')
      )
      .mockResolvedValueOnce(
        decision('context', 'Payment succeeds but delivery fails.')
      )
      .mockResolvedValueOnce(
        decision('question', 'How do we keep them consistent?', true)
      )
    await turns.accept(['Suppose we have three services.'])
    await vi.advanceTimersByTimeAsync(60000)
    await turns.accept(['Payment succeeds but delivery fails.'])
    await vi.advanceTimersByTimeAsync(30000)
    await turns.accept(['How do we keep them consistent?'])
    await vi.advanceTimersByTimeAsync(60000)
    expect(onCommit).not.toHaveBeenCalled()
    turns.sendNow()
    expect(onCommit.mock.calls[0][0].text).toBe(
      'Suppose we have three services. Payment succeeds but delivery fails. How do we keep them consistent?'
    )
  })
  it('retains completed scenario fragments and separate topics without replacing the visible draft', async () => {
    const { turns, judge, onCommit, onDraft } = setup()
    judge
      .mockResolvedValueOnce(decision('question', 'Compare ECS and EKS.', true))
      .mockResolvedValueOnce(
        decision('question', 'Which one is cheaper?', true)
      )
      .mockResolvedValueOnce(decision('new-question', 'Explain DNS.', true))
    await turns.accept(['Compare ECS and EKS.'])
    const id = onDraft.mock.calls.at(-1)![0]!.id
    await turns.accept(['Which one is cheaper?'])
    expect(onDraft.mock.calls.at(-1)![0]).toMatchObject({
      id,
      text: 'Compare ECS and EKS. Which one is cheaper?',
      queuedQuestions: 0,
    })
    await turns.accept(['Explain DNS.'])
    expect(onDraft.mock.calls.at(-1)![0]).toMatchObject({
      id,
      queuedQuestions: 1,
    })
    turns.sendNow()
    expect(onCommit.mock.calls[0][0].text).toBe(
      'Compare ECS and EKS. Which one is cheaper?'
    )
    expect(onDraft.mock.calls.at(-1)![0]?.text).toBe('Explain DNS.')
    turns.sendNow()
    expect(onCommit.mock.calls[1][0].text).toBe('Explain DNS.')
  })
  it('keeps unfinished scenario context even when its closing question is classified new', async () => {
    const { turns, judge, onDraft, onCommit } = setup()
    judge
      .mockResolvedValueOnce(decision('context', 'Suppose payment succeeds.'))
      .mockResolvedValueOnce(
        decision('new-question', 'How do we recover?', true)
      )
    await turns.accept(['Suppose payment succeeds.'])
    const id = onDraft.mock.calls.at(-1)![0]!.id
    await turns.accept(['How do we recover?'])
    expect(onDraft.mock.calls.at(-1)![0]).toMatchObject({
      id,
      text: 'Suppose payment succeeds. How do we recover?',
      queuedQuestions: 0,
    })
    turns.sendNow()
    expect(onCommit.mock.calls[0][0].text).toBe(
      'Suppose payment succeeds. How do we recover?'
    )
  })
  it('reset cancels every held topic and ignores old in-flight decisions', async () => {
    const { turns, judge, onDraft } = setup()
    let resolve!: (d: TurnDecision) => void
    judge.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      })
    )
    const first = turns.accept(['Explain DNS.'])
    await Promise.resolve()
    const second = turns.accept(['Explain JVM.'])
    turns.reset()
    resolve(decision('question', 'Explain DNS.', true))
    await Promise.all([first, second])
    expect(onDraft).toHaveBeenLastCalledWith(null)
    expect(turns.sendNow()).toBe(false)
    expect(judge).toHaveBeenCalledTimes(1)
  })
  it('allows finalized speech to be approved before the judge returns without resurrection', async () => {
    const { turns, judge, onCommit, onDraft } = setup()
    let resolve!: (d: TurnDecision) => void
    judge.mockReturnValue(
      new Promise((r) => {
        resolve = r
      })
    )
    const run = turns.accept(['How does DNS work?'])
    await Promise.resolve()
    expect(onDraft.mock.calls.at(-1)![0]?.text).toBe('How does DNS work?')
    turns.sendNow()
    expect(onCommit).toHaveBeenCalledTimes(1)
    resolve(decision('question', 'How does DNS work?', true))
    await run
    expect(onDraft).toHaveBeenLastCalledWith(null)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('retains raw speech when advisory classification skips it or fails', async () => {
    const { turns, judge, onDraft, onCommit } = setup()
    judge
      .mockResolvedValueOnce(decision('skip', ''))
      .mockRejectedValueOnce(new Error('timeout'))
    await turns.accept(['Suppose payment succeeds.'])
    await turns.accept(['How do we recover?'])
    expect(onDraft.mock.calls.at(-1)![0]?.text).toBe(
      'Suppose payment succeeds. How do we recover?'
    )
    turns.sendNow()
    expect(onCommit.mock.calls[0][0].text).toBe(
      'Suppose payment succeeds. How do we recover?'
    )
  })
  it('reviews queued questions independently without discarding the rest', async () => {
    const { turns, judge, onDraft, onCommit } = setup()
    judge.mockResolvedValue(decision('new-question', 'question', true))
    await turns.accept(['Explain DNS.'])
    await turns.accept(['Explain JVM.'])
    await turns.accept(['Explain TLS.'])
    expect(onDraft.mock.calls.at(-1)![0]).toMatchObject({
      text: 'Explain DNS.',
      queuedQuestions: 2,
    })
    turns.next()
    expect(onDraft.mock.calls.at(-1)![0]?.text).toBe('Explain JVM.')
    turns.discard()
    turns.sendNow()
    turns.sendNow()
    expect(onCommit.mock.calls.map(([turn]) => turn.text)).toEqual([
      'Explain DNS.',
      'Explain TLS.',
    ])
  })
  it.each(['followup', 'new-question'] as const)(
    'requires approval for %s and creates a separate prompt',
    async (action) => {
      const { turns, judge, onCommit } = setup()
      judge
        .mockResolvedValueOnce(decision('question', 'How does DNS work?', true))
        .mockResolvedValueOnce(decision(action, 'What about caching?', true))
      await turns.accept(['How does DNS work?'])
      turns.sendNow()
      await turns.accept(['What about caching?'])
      await vi.advanceTimersByTimeAsync(120000)
      expect(onCommit).toHaveBeenCalledTimes(1)
      expect(judge.mock.calls[1][1]).toMatchObject({
        active: 'How does DNS work?',
      })
      turns.sendNow()
      const [first, second] = onCommit.mock.calls.map((c) => c[0])
      expect(second.id).not.toBe(first.id)
      expect(second).toMatchObject({
        text: 'What about caching?',
        relation: 'new',
        version: 1,
        origin: 'send-now',
      })
    }
  )
  it('never authorizes future speech when no finalized draft exists', () => {
    const { turns, onCommit } = setup()
    expect(turns.sendNow()).toBe(false)
    expect(onCommit).not.toHaveBeenCalled()
  })
  it('approves the visible draft immediately while later speech is judged', async () => {
    const { turns, judge, onCommit, onDraft } = setup()
    judge.mockResolvedValueOnce(decision('context', 'How would you migrate it'))
    await turns.accept(['How would you migrate it'])
    let resolve!: (d: TurnDecision) => void
    judge.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      })
    )
    const next = turns.accept(['with zero downtime?'])
    await Promise.resolve()
    turns.sendNow()
    expect(onCommit.mock.calls[0][0].text).toBe(
      'How would you migrate it with zero downtime?'
    )
    resolve(decision('question', 'with zero downtime?', true))
    await next
    await vi.advanceTimersByTimeAsync(10000)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onDraft).toHaveBeenLastCalledWith(null)
  })
  it('discard invalidates in-flight and queued speech without affecting later approval policy', async () => {
    const { turns, judge, onCommit, onDraft } = setup()
    let resolve!: (d: TurnDecision) => void
    judge.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      })
    )
    const first = turns.accept(['How does DNS work?'])
    await Promise.resolve()
    const second = turns.accept(['And caching?'])
    turns.discard()
    resolve(decision('question', 'How does DNS work?', true))
    await Promise.all([first, second])
    expect(judge).toHaveBeenCalledTimes(1)
    expect(onDraft).toHaveBeenLastCalledWith(null)
    judge.mockResolvedValue(decision('new-question', 'Explain JVM.', true))
    await turns.accept(['Explain JVM.'])
    await vi.advanceTimersByTimeAsync(10000)
    expect(onCommit).not.toHaveBeenCalled()
    turns.sendNow()
    expect(onCommit.mock.calls[0][0].text).toBe('Explain JVM.')
  })
  it('stop invalidates a delayed judgement and manual sending', async () => {
    const { turns, judge, onCommit } = setup()
    let resolve!: (d: TurnDecision) => void
    judge.mockReturnValue(
      new Promise((r) => {
        resolve = r
      })
    )
    const run = turns.accept(['How does DNS work?'])
    await Promise.resolve()
    turns.stop()
    resolve(decision('question', 'How does DNS work?', true))
    await run
    expect(turns.sendNow()).toBe(false)
    expect(onCommit).not.toHaveBeenCalled()
  })
  it('uncertain recommendations only send through explicit confirmation', async () => {
    const { turns, judge, onCommit, onSuggest } = setup()
    judge.mockResolvedValue(decision('suggest', 'What about caching?'))
    await turns.accept(['What about caching?'])
    await vi.advanceTimersByTimeAsync(10000)
    expect(onSuggest).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
    turns.confirm('What about caching?')
    expect(onCommit.mock.calls[0][0]).toMatchObject({
      text: 'What about caching?',
      relation: 'new',
      origin: 'suggestion',
    })
  })
  it('retains immutable per-clip capture timestamps when approved', async () => {
    const { turns, judge, onCommit } = setup()
    judge.mockResolvedValue(decision('question', 'How does DNS work?', true))
    const captureEnd = Date.now() - 1200
    await turns.accept(['How does DNS work?'], false, { clipId: 8, captureEnd })
    turns.audioActivity(true)
    turns.audioActivity(false)
    turns.sendNow()
    expect(onCommit.mock.calls[0][0]).toMatchObject({ clip: 8, captureEnd })
  })
})
