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
  it('disagreements and a failed second judge require confirmation', async () => {
    vi.mocked(requestSpeakerJudge)
      .mockResolvedValueOnce(result('question', 'How do we recover?'))
      .mockResolvedValueOnce(result('skip', ''))
    expect(
      (
        await judgeSpeakerTurn(['How do we recover?'], context, {
          apiKey: 'test',
          judge: 'groq-20b',
          secondJudge: 'groq-120b',
        })
      ).action
    ).toBe('suggest')
    vi.mocked(requestSpeakerJudge)
      .mockResolvedValueOnce(result('question', 'How do we recover?'))
      .mockRejectedValueOnce(new Error('offline'))
    expect(
      (
        await judgeSpeakerTurn(['How do we recover?'], context, {
          apiKey: 'test',
          judge: 'groq-20b',
          secondJudge: 'groq-120b',
        })
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
})
