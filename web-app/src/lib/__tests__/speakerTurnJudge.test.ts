import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  judgeSpeakerTurn,
  parseTurnDecision,
  turnDecisionSchema,
} from '../speakerTurnJudge'
import { requestSpeakerJudge } from '../speakerFilter'
import { createQuestionTurns } from '../speakerTurns'
vi.mock('../speakerFilter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../speakerFilter')>()),
  requestSpeakerJudge: vi.fn(),
}))
const empty = { pending: '', active: '', recent: [] }
const scenario = { ...empty, pending: 'Suppose three services fail.' }
const reply = (
  intent: string,
  relation = 'new',
  transcript = 0,
  span: string | null = null
) => ({
  reply: JSON.stringify({ intent, relation, transcript, span }),
  model: 'test',
  ms: 10,
  finishReason: 'stop',
})
afterEach(() => {
  vi.mocked(requestSpeakerJudge).mockReset()
  vi.useRealTimers()
})
describe('speaker intent protocol', () => {
  it('asks for three intents with no model-generated explanation or completeness field', async () => {
    vi.mocked(requestSpeakerJudge).mockResolvedValue(
      reply('question', 'current', 1)
    )
    const d = await judgeSpeakerTurn(
      ['How would we recover?', 'How do we recover?'],
      scenario,
      { apiKey: 'test' }
    )
    expect(d).toMatchObject({
      action: 'question',
      complete: true,
      text: 'How do we recover?',
    })
    const [, user, fullUser, config] =
      vi.mocked(requestSpeakerJudge).mock.calls[0]
    expect(user).toBe(fullUser)
    expect(JSON.parse(user).pending).toBe(scenario.pending)
    expect(config.jsonSchema).toEqual(turnDecisionSchema(2))
    expect(turnDecisionSchema(2).required).toEqual([
      'intent',
      'relation',
      'transcript',
      'span',
    ])
  })
  it('maps a clear standalone question to automatic readiness', () => {
    const words = 'Out of all of these things, what do you work regularly on?'
    expect(parseTurnDecision(reply('question').reply, [words])).toMatchObject({
      action: 'new-question',
      complete: true,
      text: words,
    })
  })
  it('holds a paused scenario without inventing a question', () => {
    expect(
      parseTurnDecision(reply('hold').reply, ['Suppose three services fail.'])
    ).toMatchObject({ complete: false })
  })
  it('distinguishes unfinished and complete same-topic follow-ups', () => {
    const context = { ...empty, active: 'How does DNS work?' }
    expect(
      parseTurnDecision(
        reply('hold', 'current').reply,
        ['And when the cache'],
        context
      )
    ).toMatchObject({ action: 'followup', complete: false })
    expect(
      parseTurnDecision(
        reply('question', 'current').reply,
        ['And what about caching?'],
        context
      )
    ).toMatchObject({ action: 'followup', complete: true })
  })
  it('rejects candidate answers even if irrelevant metadata is omitted', () => {
    expect(
      parseTurnDecision('{"intent":"ignore"}', [
        'I work on tasks and automation.',
      ])
    ).toMatchObject({ action: 'skip', text: '' })
  })
  it('retains only a verified question span from mixed speech', () => {
    expect(
      parseTurnDecision(reply('question', 'new', 0, 'How do we recover?').reply, [
        'How do we recover? We restart the service.',
      ]).text
    ).toBe('How do we recover?')
    expect(
      parseTurnDecision(reply('question', 'new', 0, 'Invented question').reply, [
        'How do we recover?',
      ]).action
    ).toBe('suggest')
  })
  it('rejects unknown intents, relations, wrong index types and unavailable transcripts with field diagnostics', () => {
    for (const data of [
      { intent: 'answer|hold|ignore', relation: 'new', transcript: 0 },
      { intent: 'question', relation: 'maybe', transcript: 0 },
      { intent: 'question', relation: 'new', transcript: '0' },
      { intent: 'question', relation: 'new', transcript: 4 },
    ]) {
      const d = parseTurnDecision(JSON.stringify(data), [
        'What is your strong zone?',
      ])
      expect(d.action).toBe('suggest')
      expect(d.reason).toContain('Invalid judge fields:')
    }
  })
  it('never guesses from legacy, malformed or missing semantic output', () => {
    for (const data of [
      'YES',
      '{}',
      '{"action":"question","complete":true}',
      '[]',
    ])
      expect(
        parseTurnDecision(data, ['What is your strong zone?']).action
      ).toBe('suggest')
  })
  it('does not wait for a second judge after a valid primary intent', async () => {
    vi.mocked(requestSpeakerJudge).mockResolvedValue(reply('question'))
    expect(
      (
        await judgeSpeakerTurn(['What is your strong zone?'], empty, {
          apiKey: 'test',
          judge: 'groq-20b',
          secondJudge: 'groq-120b',
        })
      ).complete
    ).toBe(true)
    expect(requestSpeakerJudge).toHaveBeenCalledTimes(1)
  })
  it('recovers malformed output once and logs provider, invalid fields and finish reason', async () => {
    vi.mocked(requestSpeakerJudge)
      .mockResolvedValueOnce({
        reply: '{}',
        model: 'test',
        ms: 10,
        finishReason: 'length',
      })
      .mockResolvedValueOnce(reply('question'))
    const check = vi.fn()
    expect(
      (
        await judgeSpeakerTurn(
          ['What is your strong zone?'],
          empty,
          { apiKey: 'test' },
          check
        )
      ).complete
    ).toBe(true)
    expect(requestSpeakerJudge).toHaveBeenCalledTimes(2)
    expect(check.mock.calls[0][0].note).toContain('finish=length')
    expect(check.mock.calls[0][0].note).toContain('Invalid judge fields')
    expect(
      JSON.parse(vi.mocked(requestSpeakerJudge).mock.calls[1][1])
        .validationFeedback
    ).toContain('Invalid judge fields')
  })
  it('bounds failed validation recovery and keeps a manual fallback', async () => {
    vi.mocked(requestSpeakerJudge).mockResolvedValue({
      reply: '{}',
      model: 'test',
      ms: 10,
    })
    expect(
      (
        await judgeSpeakerTurn(['What is your strong zone?'], empty, {
          apiKey: 'test',
        })
      ).action
    ).toBe('suggest')
    expect(requestSpeakerJudge).toHaveBeenCalledTimes(2)
  })
  it('does not add another network request for a valid hold decision', async () => {
    vi.mocked(requestSpeakerJudge).mockResolvedValue(reply('hold'))
    expect(
      (
        await judgeSpeakerTurn(['Suppose three services fail.'], empty, {
          apiKey: 'test',
          secondJudge: 'groq-120b',
        })
      ).complete
    ).toBe(false)
    expect(requestSpeakerJudge).toHaveBeenCalledTimes(1)
  })
  it('uses an available provider when the saved selection has no key', async () => {
    vi.mocked(requestSpeakerJudge).mockResolvedValue(reply('question'))
    await judgeSpeakerTurn(['What is your strong zone?'], empty, {
      anthropic: { apiKey: 'test' },
    })
    expect(vi.mocked(requestSpeakerJudge).mock.calls[0][3].judge).toBe(
      'claude-haiku'
    )
  })
  it('does not fabricate automatic readiness when a provider is missing or unavailable', async () => {
    expect(
      (await judgeSpeakerTurn(['What is your strong zone?'], empty, {})).action
    ).toBe('suggest')
    expect(requestSpeakerJudge).not.toHaveBeenCalled()
    vi.mocked(requestSpeakerJudge).mockRejectedValue(new Error('offline'))
    expect(
      (
        await judgeSpeakerTurn(['What is your strong zone?'], empty, {
          apiKey: 'test',
        })
      ).action
    ).toBe('suggest')
  })
  it('ignores candidate statements before calling the judge', async () => {
    for (const text of [
      'I work on tasks and automation.',
      'We build scalable services.',
      'My responsibilities include testing.',
    ]) {
      expect(
        (await judgeSpeakerTurn([text], empty, { apiKey: 'test' })).action
      ).toBe('skip')
    }
    expect(requestSpeakerJudge).not.toHaveBeenCalled()
  })
  it('does not turn missing providers or invalid judgements into recommendations for background speech', async () => {
    expect(
      (
        await judgeSpeakerTurn(
          ['Suppose three services share a queue.'],
          empty,
          {}
        )
      ).action
    ).toBe('skip')
    vi.mocked(requestSpeakerJudge).mockResolvedValue({
      reply: '{}',
      model: 'test',
      ms: 10,
    })
    expect(
      (
        await judgeSpeakerTurn(['The database has two replicas.'], empty, {
          apiKey: 'test',
        })
      ).action
    ).toBe('skip')
    expect(requestSpeakerJudge).toHaveBeenCalledTimes(1)
  })
  it('does not interpret the old ambiguous answer label as an automatic question', () => {
    expect(parseTurnDecision(reply('answer').reply, ['How does DNS work?'], empty).action).toBe('suggest')
  })
  it('rejects the exact live candidate passages even when the model calls them answerable', () => {
    for (const text of [
      'So I generally do have mostly like CI/CD tasks. We do get tasks.',
      'That is actually … maintained by another team…',
    ]) {
      expect(
        parseTurnDecision(reply('question').reply, [text], empty).action
      ).toBe('skip')
    }
  })
  it('keeps dependent live follow-ups on the current question despite a new label', () => {
    expect(
      parseTurnDecision(
        reply('question').reply,
        ['Out of all of these things, what do you work regularly on?'],
        { ...empty, active: 'What is your strong zone?' }
      ).action
    ).toBe('followup')
    expect(
      parseTurnDecision(
        reply('question').reply,
        ['Do you have it running in a container or on EC2?'],
        { ...empty, active: 'How did you integrate Vault?' }
      )
    ).toMatchObject({ action: 'followup', complete: true })
  })
  it('requires extraction of the question from a mixed candidate/question clip', () => {
    const text =
      'I maintain the pipelines. How do you rotate their credentials?'
    expect(parseTurnDecision(reply('question').reply, [text], empty).action).toBe(
      'suggest'
    )
    expect(
      parseTurnDecision(
        reply('question', 'new', 0, 'How do you rotate their credentials?').reply,
        [text],
        empty
      )
    ).toMatchObject({
      action: 'new-question',
      complete: true,
      text: 'How do you rotate their credentials?',
    })
  })
  it('automatically sends the reported question, updates its real follow-up and excludes the candidate answer', async () => {
    vi.useFakeTimers()
    vi.mocked(requestSpeakerJudge)
      .mockResolvedValueOnce(reply('question'))
      .mockResolvedValueOnce(reply('question', 'current'))
      .mockResolvedValueOnce(reply('ignore'))
    const onCommit = vi.fn()
    const turns = createQuestionTurns({
      judge: (texts, context) =>
        judgeSpeakerTurn(texts, context, { apiKey: 'test' }),
      onCommit,
      onDraft: () => {},
      onSuggest: vi.fn(),
    })
    await turns.accept(['What is your strong zone?'])
    await vi.advanceTimersByTimeAsync(500)
    await turns.accept([
      'Out of all of these things, what do you work regularly on?',
    ])
    await vi.advanceTimersByTimeAsync(500)
    await turns.accept(['I work on tasks and automation.'])
    await vi.advanceTimersByTimeAsync(10000)
    expect(onCommit).toHaveBeenCalledTimes(2)
    const [first, second] = onCommit.mock.calls.map(([turn]) => turn)
    expect(first.origin).toBe('automatic')
    expect(second).toMatchObject({
      id: first.id,
      version: 2,
      origin: 'automatic',
      text: 'What is your strong zone? Out of all of these things, what do you work regularly on?',
    })
    turns.stop()
  })
})
