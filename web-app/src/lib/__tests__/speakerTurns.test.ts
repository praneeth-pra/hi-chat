import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createQuestionTurns,
  QUESTION_SETTLE_MS,
  type QuestionDraft,
} from '../speakerTurns'
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

describe('question-turn coordination', () => {
  it('keeps a long scenario across gaps and sends all three parts once', async () => {
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
    expect(onCommit).not.toHaveBeenCalled()
    await turns.accept(['How do we keep them consistent?'])
    await vi.advanceTimersByTimeAsync(QUESTION_SETTLE_MS)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit.mock.calls[0][0].text).toBe(
      'Suppose we have three services. Payment succeeds but delivery fails. How do we keep them consistent?'
    )
  })
  it('joins a follow-up before delivery and extends the settling window', async () => {
    const { turns, judge, onCommit } = setup()
    judge
      .mockResolvedValueOnce(decision('question', 'How does DNS work?', true))
      .mockResolvedValueOnce(
        decision('followup', 'And what about caching?', true)
      )
    await turns.accept(['How does DNS work?'])
    await vi.advanceTimersByTimeAsync(400)
    await turns.accept(['And what about caching?'])
    await vi.advanceTimersByTimeAsync(400)
    expect(onCommit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(onCommit.mock.calls[0][0].text).toBe(
      'How does DNS work? And what about caching?'
    )
  })
  it('versions follow-ups to the same question, including after its answer', async () => {
    const { turns, judge, onCommit } = setup()
    judge
      .mockResolvedValueOnce(decision('question', 'How does DNS work?', true))
      .mockResolvedValueOnce(
        decision('followup', 'And what about caching?', true)
      )
    await turns.accept(['How does DNS work?'])
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(120000)
    await turns.accept(['And what about caching?'])
    await vi.advanceTimersByTimeAsync(500)
    const [first, second] = onCommit.mock.calls.map((c) => c[0])
    expect(second).toMatchObject({
      id: first.id,
      version: 2,
      relation: 'update',
      text: 'How does DNS work? And what about caching?',
    })
    expect(judge.mock.calls[1][1]).toMatchObject({
      active: 'How does DNS work?',
    })
  })
  it('uses a different turn for a clearly separate topic', async () => {
    const { turns, judge, onCommit } = setup()
    judge
      .mockResolvedValueOnce(decision('question', 'How does DNS work?', true))
      .mockResolvedValueOnce(
        decision('new-question', 'Explain garbage collection.', true)
      )
    await turns.accept(['How does DNS work?'])
    await vi.advanceTimersByTimeAsync(500)
    await turns.accept(['Explain garbage collection.'])
    await vi.advanceTimersByTimeAsync(500)
    expect(onCommit.mock.calls[1][0].id).not.toBe(onCommit.mock.calls[0][0].id)
    expect(onCommit.mock.calls[1][0].text).toBe('Explain garbage collection.')
  })
  it('never sends a complete question while speech or transcription continues', async () => {
    const { turns, judge, onCommit } = setup()
    judge.mockResolvedValue(decision('question', 'How does DNS work?', true))
    turns.activity(true)
    await turns.accept(['How does DNS work?'])
    await vi.advanceTimersByTimeAsync(20000)
    expect(onCommit).not.toHaveBeenCalled()
    turns.activity(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('keeps listening until manually committed and excludes chatter', async () => {
    const { turns, judge, onCommit } = setup()
    judge
      .mockResolvedValueOnce(decision('question', 'How does DNS work?', true))
      .mockResolvedValueOnce(decision('skip', 'Okay.'))
    await turns.accept(['How does DNS work?'])
    turns.keepListening()
    await turns.accept(['Okay.'])
    await vi.advanceTimersByTimeAsync(60000)
    expect(onCommit).not.toHaveBeenCalled()
    turns.sendNow()
    expect(onCommit.mock.calls[0][0].text).toBe('How does DNS work?')
  })
  it('lets Send now commit an incomplete scenario explicitly', async () => {
    const { turns, judge, onCommit } = setup()
    judge.mockResolvedValue(
      decision('context', 'Suppose we have three services.')
    )
    await turns.accept(['Suppose we have three services.'])
    turns.sendNow()
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('waits for an in-flight transcript when Send now is pressed', async () => {
    const { turns, judge, onCommit } = setup()
    let resolve!: (d: TurnDecision) => void
    judge.mockReturnValue(
      new Promise((r) => {
        resolve = r
      })
    )
    const run = turns.accept(['Suppose we have three services.'])
    await Promise.resolve()
    turns.sendNow()
    expect(onCommit).not.toHaveBeenCalled()
    resolve(decision('context', 'Suppose we have three services.'))
    await run
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('discards an in-flight judgement and its queued continuation', async () => {
    const { turns, judge, onCommit, onDraft } = setup()
    let resolve!: (d: TurnDecision) => void
    judge.mockReturnValue(
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
    await vi.advanceTimersByTimeAsync(10000)
    expect(judge).toHaveBeenCalledTimes(1)
    expect(onCommit).not.toHaveBeenCalled()
    expect(onDraft).toHaveBeenLastCalledWith(null)
  })
  it('stopping invalidates a delayed judgement', async () => {
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
    await vi.advanceTimersByTimeAsync(10000)
    expect(onCommit).not.toHaveBeenCalled()
  })
  it('an uncertain continuation blocks automatic delivery of the earlier draft', async () => {
    const { turns, judge, onCommit, onSuggest } = setup()
    judge
      .mockResolvedValueOnce(decision('question', 'How does DNS work?', true))
      .mockResolvedValueOnce(decision('suggest', 'Unclear follow-up.'))
    await turns.accept(['How does DNS work?'])
    await turns.accept(['Unclear follow-up.'])
    await vi.advanceTimersByTimeAsync(10000)
    expect(onCommit).not.toHaveBeenCalled()
    expect(onSuggest).toHaveBeenCalledWith('Unclear follow-up.', 'test')
    turns.confirm('What about caching?')
    expect(onCommit.mock.calls[0][0].text).toBe(
      'How does DNS work? What about caching?'
    )
  })
  it('retains an incomplete scenario as a suggestion when a new topic begins', async () => {
    const { turns, judge, onCommit, onSuggest } = setup()
    judge
      .mockResolvedValueOnce(
        decision('context', 'Suppose three services fail.')
      )
      .mockResolvedValueOnce(
        decision('new-question', 'Explain garbage collection.', true)
      )
    await turns.accept(['Suppose three services fail.'])
    await turns.accept(['Explain garbage collection.'])
    await vi.advanceTimersByTimeAsync(500)
    expect(onSuggest).toHaveBeenCalledWith(
      'Suppose three services fail.',
      'test'
    )
    expect(onCommit.mock.calls[0][0].text).toBe('Explain garbage collection.')
  })
  it('automatically recovers from temporary uncertainty when later speech completes the question', async () => {
    const { turns, judge, onCommit } = setup()
    judge
      .mockResolvedValueOnce(
        decision('context', 'Suppose three services fail.')
      )
      .mockResolvedValueOnce(decision('suggest', 'Unclear audio.'))
      .mockResolvedValueOnce(decision('question', 'How do we recover?', true))
    await turns.accept(['Suppose three services fail.'])
    await turns.accept(['Unclear audio.'])
    await vi.advanceTimersByTimeAsync(10000)
    expect(onCommit).not.toHaveBeenCalled()
    await turns.accept(['How do we recover?'])
    await vi.advanceTimersByTimeAsync(500)
    expect(onCommit.mock.calls[0][0].text).toBe(
      'Suppose three services fail. How do we recover?'
    )
  })
  it('preserves an explicit Keep listening hold through later clear speech', async () => {
    const { turns, judge, onCommit } = setup()
    judge
      .mockResolvedValueOnce(
        decision('context', 'Suppose three services fail.')
      )
      .mockResolvedValueOnce(decision('question', 'How do we recover?', true))
    await turns.accept(['Suppose three services fail.'])
    turns.keepListening()
    await turns.accept(['How do we recover?'])
    await vi.advanceTimersByTimeAsync(10000)
    expect(onCommit).not.toHaveBeenCalled()
    turns.sendNow()
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('overlaps settling with transcription instead of adding another full delay', async () => {
    const { turns, judge, onCommit } = setup()
    turns.audioActivity(true)
    turns.activity(true)
    turns.audioActivity(false)
    await vi.advanceTimersByTimeAsync(700)
    judge.mockResolvedValue(decision('question', 'How does DNS work?', true))
    await turns.accept(['How does DNS work?'])
    turns.activity(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('only waits the remainder when processing finishes within the settling window', async () => {
    const { turns, judge, onCommit } = setup()
    turns.audioActivity(true)
    turns.audioActivity(false)
    await vi.advanceTimersByTimeAsync(300)
    judge.mockResolvedValue(decision('question', 'How does DNS work?', true))
    await turns.accept(['How does DNS work?'])
    await vi.advanceTimersByTimeAsync(199)
    expect(onCommit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('uses a bounded one-second acoustic hold that cannot expire an incomplete scenario', async () => {
    const { turns, judge, onCommit } = setup()
    judge
      .mockResolvedValueOnce(
        decision('context', 'Suppose three services fail.')
      )
      .mockResolvedValueOnce(decision('question', 'How do we recover?', true))
    await turns.accept(['Suppose three services fail.'], true)
    await vi.advanceTimersByTimeAsync(10000)
    expect(onCommit).not.toHaveBeenCalled()
    await turns.accept(['How do we recover?'], true)
    await vi.advanceTimersByTimeAsync(999)
    expect(onCommit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('resuming speech cancels overlapping delivery until the next quiet interval', async () => {
    const { turns, judge, onCommit } = setup()
    turns.audioActivity(true)
    turns.audioActivity(false)
    await vi.advanceTimersByTimeAsync(300)
    judge.mockResolvedValue(decision('question', 'How does DNS work?', true))
    await turns.accept(['How does DNS work?'])
    turns.audioActivity(true)
    turns.activity(true)
    await vi.advanceTimersByTimeAsync(10000)
    expect(onCommit).not.toHaveBeenCalled()
    turns.audioActivity(false)
    turns.activity(false)
    await vi.advanceTimersByTimeAsync(499)
    expect(onCommit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
})
