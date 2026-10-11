import { beforeEach, describe, expect, it, vi } from 'vitest'
import { judgeSpeakerTurn, parseTurnDecision } from '../speakerTurnJudge'
import { requestSpeakerJudge } from '../speakerFilter'
vi.mock('../speakerFilter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../speakerFilter')>()),
  requestSpeakerJudge: vi.fn(),
}))
const context = {
  pending: 'Suppose three services fail.',
  active: '',
  recent: [],
}
const result = (action: string, text: string, complete = true) => ({
  reply: JSON.stringify({ action, text, complete, reason: 'test' }),
  model: 'test-model',
  ms: 10,
})
beforeEach(() => {
  vi.mocked(requestSpeakerJudge).mockReset()
})
describe('structured turn judgement', () => {
  it('uses all three transcripts and the same scenario context for provider routing', async () => {
    vi.mocked(requestSpeakerJudge).mockResolvedValue(
      result('question', 'How do we recover?')
    )
    await judgeSpeakerTurn(
      ['How do we recover?', 'How would we recover?', 'How can we recover?'],
      context,
      { apiKey: 'test' }
    )
    const [, user, fullUser] = vi.mocked(requestSpeakerJudge).mock.calls[0]
    expect(user).toBe(fullUser)
    expect(JSON.parse(user)).toMatchObject({
      pending: context.pending,
      transcripts: [
        'How do we recover?',
        'How would we recover?',
        'How can we recover?',
      ],
    })
  })
  it('offers manual confirmation rather than auto-sending without a judge', async () => {
    const d = await judgeSpeakerTurn(
      ['Can you open any Python online compiler?'],
      context,
      {}
    )
    expect(d.action).toBe('suggest')
    expect(requestSpeakerJudge).not.toHaveBeenCalled()
  })
  it('does not promote unknown, malformed or invented output', () => {
    for (const reply of [
      'YES',
      '{}',
      JSON.stringify({
        action: 'question',
        complete: true,
        text: 'Invented question',
        reason: 'test',
      }),
    ])
      expect(parseTurnDecision(reply, ['How do we recover?']).action).toBe(
        'suggest'
      )
  })
  it('context can never be complete even if the model contradicts itself', () => {
    expect(
      parseTurnDecision(
        result('context', 'Suppose three services fail.').reply,
        [context.pending]
      ).complete
    ).toBe(false)
  })
  it('sends a valid primary decision without asking or waiting for a second judge', async () => {
    vi.mocked(requestSpeakerJudge).mockResolvedValue(
      result('question', 'How do we recover?')
    )
    const d = await judgeSpeakerTurn(['How do we recover?'], context, {
      apiKey: 'test',
      judge: 'groq-20b',
      secondJudge: 'groq-120b',
    })
    expect(d.action).toBe('question')
    expect(d.complete).toBe(true)
    expect(requestSpeakerJudge).toHaveBeenCalledTimes(1)
  })
  it('uses the second judge to recover an unclear primary decision', async () => {
    vi.mocked(requestSpeakerJudge)
      .mockResolvedValueOnce(result('suggest', 'How do we recover?', false))
      .mockResolvedValueOnce(result('question', 'How do we recover?'))
    const d = await judgeSpeakerTurn(['How do we recover?'], context, {
      apiKey: 'test',
      judge: 'groq-20b',
      secondJudge: 'groq-120b',
    })
    expect(d.action).toBe('question')
    expect(requestSpeakerJudge).toHaveBeenCalledTimes(2)
  })
  it('does not promote a skip when a second judge is configured', async () => {
    vi.mocked(requestSpeakerJudge).mockResolvedValue(result('skip', ''))
    expect(
      (
        await judgeSpeakerTurn(['Can you open a compiler?'], context, {
          apiKey: 'test',
          judge: 'groq-20b',
          secondJudge: 'groq-120b',
        })
      ).action
    ).toBe('skip')
    expect(requestSpeakerJudge).toHaveBeenCalledTimes(1)
  })
  it('routes to an available provider when the saved selection has no key', async () => {
    vi.mocked(requestSpeakerJudge).mockResolvedValue(
      result('question', 'How do we recover?')
    )
    await judgeSpeakerTurn(['How do we recover?'], context, {
      judge: 'cerebras-120b',
      anthropic: { apiKey: 'test' },
    })
    expect(vi.mocked(requestSpeakerJudge).mock.calls[0][3].judge).toBe(
      'claude-haiku'
    )
  })
  it('can recover a failed primary request through a configured second judge', async () => {
    vi.mocked(requestSpeakerJudge)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(result('question', 'How do we recover?'))
    expect(
      (
        await judgeSpeakerTurn(['How do we recover?'], context, {
          apiKey: 'test',
          judge: 'groq-20b',
          secondJudge: 'groq-120b',
        })
      ).action
    ).toBe('question')
  })
  it('selects a whole transcript without asking the model to repeat it', () => {
    expect(
      parseTurnDecision(
        JSON.stringify({
          action: 'question',
          complete: true,
          transcript: 1,
          reason: 'complete',
        }),
        ['How we cover?', 'How do we recover?']
      ).text
    ).toBe('How do we recover?')
    expect(
      parseTurnDecision(
        JSON.stringify({
          action: 'question',
          complete: true,
          transcript: 5,
          reason: 'complete',
        }),
        ['How do we recover?']
      ).action
    ).toBe('suggest')
  })
  it('retains a contiguous question span and excludes an answer after it', () => {
    const d = parseTurnDecision(
      result('question', 'How do we recover?').reply,
      ['How do we recover? We restart the service.']
    )
    expect(d.text).toBe('How do we recover?')
  })
  it('provider errors become suggestions', async () => {
    vi.mocked(requestSpeakerJudge).mockRejectedValue(new Error('offline'))
    expect(
      (
        await judgeSpeakerTurn(['How do we recover?'], context, {
          apiKey: 'test',
        })
      ).action
    ).toBe('suggest')
  })
  it('does not retry an unclear secondary after a failed primary', async () => {
    vi.mocked(requestSpeakerJudge)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(result('suggest', 'How do we recover?', false))
    expect(
      (
        await judgeSpeakerTurn(['How do we recover?'], context, {
          apiKey: 'test',
          judge: 'groq-20b',
          secondJudge: 'groq-120b',
        })
      ).action
    ).toBe('suggest')
    expect(requestSpeakerJudge).toHaveBeenCalledTimes(2)
  })
})
