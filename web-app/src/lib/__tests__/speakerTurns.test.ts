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
  it('does not recommend the old question when a held addition is superseded by a new topic', async () => {
    const { turns, judge, onCommit, onSuggest } = setup()
    judge
      .mockResolvedValueOnce(decision('question', 'How does DNS work?', true))
      .mockResolvedValueOnce(decision('followup', 'With caching'))
      .mockResolvedValueOnce(
        decision('new-question', 'Explain garbage collection.', true)
      )
    await turns.accept(['How does DNS work?'])
    await vi.advanceTimersByTimeAsync(500)
    await turns.accept(['With caching'])
    await turns.accept(['Explain garbage collection.'])
    await vi.advanceTimersByTimeAsync(500)
    expect(onSuggest).not.toHaveBeenCalled()
    expect(onCommit.mock.calls[1][0]).toMatchObject({
      text: 'Explain garbage collection.',
      relation: 'new',
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
  it('sends a complete judged question despite ongoing capture', async () => {
    const { turns, judge, onCommit } = setup()
    judge.mockResolvedValue(decision('question', 'How does DNS work?', true))
    turns.activity(true)
    await turns.accept(['How does DNS work?'])
    await vi.advanceTimersByTimeAsync(500)
    expect(onCommit).toHaveBeenCalledTimes(1)
    turns.activity(false)
    await vi.advanceTimersByTimeAsync(20000)
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
  it('accepts a visible draft immediately while later speech is being judged', async () => {
    const { turns, judge, onCommit } = setup()
    judge.mockResolvedValueOnce(decision('context', 'How would you migrate it'))
    await turns.accept(['How would you migrate it'])
    let resolve!: (value: TurnDecision) => void
    judge.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    const next = turns.accept(['with zero downtime?'])
    await vi.advanceTimersByTimeAsync(0)
    turns.sendNow()
    expect(onCommit).toHaveBeenCalledTimes(1)
    resolve(decision('question', 'with zero downtime?', true))
    await next
    await vi.advanceTimersByTimeAsync(500)
    expect(onCommit.mock.calls[1][0]).toMatchObject({
      id: onCommit.mock.calls[0][0].id,
      relation: 'update',
      version: 2,
      text: 'How would you migrate it with zero downtime?',
    })
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
  it('uncertain later speech cannot erase an already complete question', async () => {
    const { turns, judge, onCommit, onSuggest } = setup()
    judge
      .mockResolvedValueOnce(decision('question', 'How does DNS work?', true))
      .mockResolvedValueOnce(decision('suggest', 'Unclear follow-up.'))
    await turns.accept(['How does DNS work?'])
    await turns.accept(['Unclear follow-up.'])
    await vi.advanceTimersByTimeAsync(10000)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit.mock.calls[0][0].text).toBe('How does DNS work?')
    expect(onSuggest).not.toHaveBeenCalled()
    turns.confirm('What about caching?')
    expect(onCommit.mock.calls[1][0].text).toBe('What about caching?')
    expect(onCommit.mock.calls[1][0].origin).toBe('suggestion')
  })
  it('does not recommend abandoned background without a question when a new topic begins', async () => {
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
    expect(onSuggest).not.toHaveBeenCalled()
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
  it('later speech cannot restart a complete question settling clock', async () => {
    const { turns, judge, onCommit } = setup()
    turns.audioActivity(true)
    turns.audioActivity(false)
    await vi.advanceTimersByTimeAsync(300)
    judge.mockResolvedValue(decision('question', 'How does DNS work?', true))
    await turns.accept(['How does DNS work?'])
    turns.audioActivity(true)
    turns.activity(true)
    await vi.advanceTimersByTimeAsync(200)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
  it('a queued continuation updates the question that committed during judgement', async () => {
    const { turns, judge, onCommit } = setup()
    judge.mockResolvedValueOnce(
      decision('question', 'How does DNS work?', true)
    )
    await turns.accept(['How does DNS work?'])
    let resolve!: (value: TurnDecision) => void
    judge.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    const next = turns.accept(['And what about caching?'])
    await vi.advanceTimersByTimeAsync(500)
    expect(onCommit).toHaveBeenCalledTimes(1)
    resolve(decision('question', 'And what about caching?', true))
    await next
    await vi.advanceTimersByTimeAsync(0)
    const [first, second] = onCommit.mock.calls.map((c) => c[0])
    expect(second).toMatchObject({
      id: first.id,
      version: 2,
      relation: 'update',
      text: 'How does DNS work? And what about caching?',
    })
  })
  it('rejected candidate answers do not enter conversation history', async () => {
    const { turns, judge } = setup()
    judge
      .mockResolvedValueOnce(decision('skip', 'I maintain pipelines.'))
      .mockResolvedValueOnce(
        decision('question', 'How do you test them?', true)
      )
    await turns.accept(['I maintain pipelines.'])
    await turns.accept(['How do you test them?'])
    expect(judge.mock.calls[1][1]).toMatchObject({ recent: [] })
  })
  it('hiding an addition retains it for completion without cancelling in-flight speech', async () => {
    const { turns, judge, onCommit, onDraft } = setup()
    judge
      .mockResolvedValueOnce(decision('question', 'How does DNS work?', true))
      .mockResolvedValueOnce(decision('followup', 'With caching.'))
    await turns.accept(['How does DNS work?'])
    await vi.advanceTimersByTimeAsync(500)
    await turns.accept(['With caching.'])
    const draft = onDraft.mock.calls.at(-1)![0]!
    expect(draft.relation).toBe('update')
    expect(draft.addition).toBe('With caching.')
    let resolve!: (decision: TurnDecision) => void
    judge.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const next = turns.accept(['What about TTL?'])
    await Promise.resolve()
    turns.expireReview(draft.id, draft.text)
    resolve(decision('followup', 'What about TTL?', true))
    await next
    await vi.advanceTimersByTimeAsync(500)
    expect(onCommit.mock.calls.at(-1)![0].text).toBe(
      'How does DNS work? With caching. What about TTL?'
    )
    expect(onCommit).toHaveBeenCalledTimes(2)
  })
  it('does not downgrade the completed Vault question when a held follow-up arrives', async () => {
    const { turns, judge, onCommit, onDraft } = setup()
    judge
      .mockResolvedValueOnce(
        decision('question', 'How did you integrate Vault?', true)
      )
      .mockResolvedValueOnce(
        decision('followup', 'Do you have it running in a container or on EC2?')
      )
      .mockResolvedValueOnce(
        decision('skip', 'That is actually maintained by another team.')
      )
    await turns.accept(['How did you integrate Vault?'])
    await turns.accept(['Do you have it running in a container or on EC2?'])
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit.mock.calls[0][0].text).toBe('How did you integrate Vault?')
    expect(onDraft.mock.calls.at(-1)![0]?.relation).toBe('update')
    await turns.accept(['That is actually maintained by another team.'])
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onDraft.mock.calls.at(-1)![0]?.text).not.toContain('another team')
  })
  it('accumulates held scenario pieces despite repeated new clip labels', async () => {
    const { turns, judge, onCommit, onSuggest } = setup()
    judge
      .mockResolvedValueOnce(
        decision('new-question', 'Suppose three services share a queue.')
      )
      .mockResolvedValueOnce(
        decision('new-question', 'One service fails during delivery.')
      )
      .mockResolvedValueOnce(
        decision('question', 'How should we recover?', true)
      )
    await turns.accept(['Suppose three services share a queue.'])
    await turns.accept(['One service fails during delivery.'])
    await turns.accept(['How should we recover?'])
    await vi.advanceTimersByTimeAsync(500)
    expect(onSuggest).not.toHaveBeenCalled()
    expect(onCommit.mock.calls[0][0].text).toBe(
      'Suppose three services share a queue. One service fails during delivery. How should we recover?'
    )
  })
  it('keeps the committing clip timestamp immutable while later audio changes the quiet state', async () => {
    const trace = vi.fn(),
      onCommit = vi.fn()
    const turns = createQuestionTurns({
      judge: async () => decision('question', 'How does DNS work?', true),
      onCommit,
      onDraft: () => {},
      onSuggest: () => {},
      onTrace: trace,
    })
    listeners.push(turns)
    await turns.accept(['How does DNS work?'], false, {
      clipId: 42,
      captureEnd: Date.now() - 100,
    })
    const captured = Date.now() - 100
    turns.audioActivity(true)
    await vi.advanceTimersByTimeAsync(50)
    turns.audioActivity(false)
    await vi.advanceTimersByTimeAsync(500)
    const commit = trace.mock.calls.find(([event]) => event === 'commit')![1]
    expect(commit.captureEnd).toBe(captured)
    expect(commit.clip).toBe(42)
    expect(onCommit.mock.calls[0][0].captureEnd).toBe(captured)
  })
  it('never appends an older recommendation or candidate answer to the active question', async () => {
    const { turns, judge, onCommit } = setup()
    judge.mockResolvedValue(
      decision(
        'question',
        'Out of all of these things, what do you work regularly on?',
        true
      )
    )
    await turns.accept([
      'Out of all of these things, what do you work regularly on?',
    ])
    await vi.advanceTimersByTimeAsync(500)
    const first = onCommit.mock.calls[0][0]
    turns.confirm('What is your strong zone?')
    const second = onCommit.mock.calls[1][0]
    expect(second.id).not.toBe(first.id)
    expect(second.text).toBe('What is your strong zone?')
    expect(second.origin).toBe('suggestion')
    turns.confirm('I work on tasks and automation.')
    expect(onCommit.mock.calls[2][0].text).toBe(
      'I work on tasks and automation.'
    )
    expect(onCommit.mock.calls[2][0].relation).toBe('new')
  })
  it('distinguishes automatic and explicit Send now commits', async () => {
    const { turns, judge, onCommit } = setup()
    judge.mockResolvedValue(decision('question', 'How does DNS work?', true))
    await turns.accept(['How does DNS work?'])
    await vi.advanceTimersByTimeAsync(500)
    expect(onCommit.mock.calls[0][0].origin).toBe('automatic')
    await turns.accept(['Explain garbage collection.'])
    turns.sendNow()
    expect(onCommit.mock.calls[1][0].origin).toBe('send-now')
  })
})
