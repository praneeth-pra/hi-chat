import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  benchClips,
  formatReplay,
  isPromptExample,
  joinedRows,
  promptExamples,
  loadLabeledClips,
  parseLabeled,
  replayLabeled,
  replaySession,
  replaySummary,
  splitSessions,
  type LabeledClip,
} from '../replayBench'
import { resetClassifierModel } from '../speakerFilter'

// The judge answers in turn; the last answer repeats
const judgeReplies = (...contents: string[]) => {
  let i = 0
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [
        { message: { content: contents[Math.min(i++, contents.length - 1)] } },
      ],
    }),
  }))
}

const clip = (
  at: string,
  text: string,
  label: 'send' | 'skip',
  judge_sent = label === 'send'
): LabeledClip => ({ at, text, label, judge_sent, coding: false })

describe('replayBench', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetClassifierModel()
  })

  it('splits interviews at long gaps', () => {
    const sessions = splitSessions([
      clip('2026-10-05T16:00:00', 'a', 'skip'),
      clip('2026-10-05T16:00:10', 'b', 'skip'),
      clip('2026-10-05T17:00:00', 'c', 'skip'),
    ])
    expect(sessions.map((s) => s.length)).toEqual([2, 1])
  })

  it('parses the labelled clips shipped with the app', async () => {
    const clips = await loadLabeledClips()
    expect(clips.length).toBeGreaterThan(1000)
    expect(clips[0]).toHaveProperty('label')
    expect(parseLabeled('\n')).toEqual([])
  })

  it('counts a held clip as sent when the question it joins is sent', async () => {
    vi.stubGlobal('fetch', judgeReplies('WAIT', 'YES', 'NO'))
    const run = await replaySession(
      [
        clip('2026-10-05T16:00:00', 'So when you designed the', 'send'),
        clip(
          '2026-10-05T16:00:02',
          'payment service, how did you scale?',
          'send'
        ),
        clip('2026-10-05T16:00:20', 'Okay, sounds good.', 'skip'),
      ],
      { apiKey: 'k' },
      true
    )
    expect(run.sent).toEqual([true, true, false])
    expect(run.held).toBe(1)
  })

  it('releases a hold nothing followed in time', async () => {
    vi.stubGlobal('fetch', judgeReplies('WAIT', 'YES', 'NO'))
    const run = await replaySession(
      [
        clip('2026-10-05T16:00:00', 'Tell me about your last project', 'send'),
        clip('2026-10-05T16:00:30', 'Okay.', 'skip'),
      ],
      { apiKey: 'k' },
      true
    )
    expect(run.sent).toEqual([true, false])
  })

  it('scores against the labels and the live judge', async () => {
    vi.stubGlobal('fetch', judgeReplies('YES'))
    const result = await replayLabeled(
      [
        clip('2026-10-05T16:00:00', 'What is a pod?', 'send'),
        clip(
          '2026-10-05T16:00:10',
          'And why did you pick Kafka there?',
          'skip',
          true
        ),
      ],
      { apiKey: 'k' },
      false
    )
    expect(result.now.chatterSent.map((c) => c.text)).toEqual([
      'And why did you pick Kafka there?',
    ])
    expect(result.live.chatterSent).toHaveLength(1)
    expect(result.now.missed).toHaveLength(0)
    expect(replaySummary(result)).toContain('chatter_sent=1 (live 1)')
    expect(formatReplay(result)).toContain(
      '"And why did you pick Kafka there?"'
    )
  })

  it('scores unseen clips apart from those quoted in the instructions', async () => {
    vi.stubGlobal('fetch', judgeReplies('YES\nType: question'))
    const result = await replayLabeled(
      [
        // Quoted word for word in the judge's instructions
        clip(
          '2026-10-05T16:00:00',
          'Why did you use a set here instead of a list?',
          'skip'
        ),
        clip('2026-10-05T16:00:10', 'How do you size a Kafka cluster?', 'send'),
      ],
      { apiKey: 'k' },
      false
    )
    expect(result.now.chatterSent).toHaveLength(1)
    expect(result.unseen.clips).toBe(1)
    expect(result.unseen.now.chatterSent).toHaveLength(0)
    expect(result.types.chatterSent).toEqual({ question: 1 })
    expect(formatReplay(result)).toContain('Chatter sent by type: question 1')
  })

  it('scores a question logged as pieces plus a joined row once', async () => {
    const clips = [
      clip('2026-10-07T06:10:03', 'Can you tell me the...', 'skip'),
      clip('2026-10-07T06:10:05', 'HTTP methods.', 'skip'),
      clip(
        '2026-10-07T06:10:11',
        'Can you tell me the... HTTP methods.',
        'send'
      ),
    ]
    expect([...joinedRows(clips)]).toEqual([[2, [0, 1]]])
    // Held, then sent joined with the second piece
    vi.stubGlobal(
      'fetch',
      judgeReplies('WAIT', 'YES: Can you tell me the HTTP methods?')
    )
    const result = await replayLabeled(clips, { apiKey: 'k' }, true)
    expect(result.clips).toBe(1)
    expect(result.now.chatterSent).toHaveLength(0)
    expect(result.now.missed).toHaveLength(0)
  })

  it('leaves out replayed recordings and stretches that were not interviews', () => {
    const q =
      'So when you create a subnet, how would you make it public or private?'
    const kept = benchClips([
      clip('2026-10-05T19:54:20', q, 'send'),
      // The interviewer repeating it soon after stays in
      clip('2026-10-05T19:55:00', q, 'send'),
      // The same recording played again later is left out
      clip('2026-10-05T20:28:41', `Okay. ${q}`, 'send'),
      clip('2026-10-06T14:27:30', 'Dinner or something new?', 'skip'),
    ])
    expect(kept.map((c) => c.at)).toEqual([
      '2026-10-05T19:54:20',
      '2026-10-05T19:55:00',
    ])
  })

  it('finds a joined row that carries a little more than its pieces', () => {
    expect([
      ...joinedRows([
        clip('2026-10-07T05:36:12', 'Any exposure to...', 'skip'),
        clip('2026-10-07T05:36:13', 'API testing also.', 'skip'),
        clip(
          '2026-10-07T05:36:16',
          "Any exposure to... API testing also. It's a postman.",
          'send'
        ),
      ]),
    ]).toEqual([[2, [0, 1]]])
  })

  it('finds clips quoted in the instructions', () => {
    const examples = promptExamples()
    expect(isPromptExample('Can you hear me now?', examples)).toBe(true)
    expect(
      isPromptExample('Okay. What is the time complexity of this?', examples)
    ).toBe(true)
    expect(isPromptExample('How do you size a Kafka cluster?', examples)).toBe(
      false
    )
  })

  it('counts a failed judge as a miss and reports it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const run = await replaySession(
      [clip('2026-10-05T16:00:00', 'What is a pod?', 'send')],
      { apiKey: 'k' },
      false
    )
    expect(run.sent).toEqual([false])
    expect(run.errors).toHaveLength(1)
  })
})
