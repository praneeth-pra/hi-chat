import { describe, it, expect, beforeEach } from 'vitest'
import { ThreadMessage } from '@janhq/core'
import {
  chatDelay,
  freshBaseline,
  readSamples,
  recordReply,
  type ReplySample,
} from '../replySpeed'

const MODEL = 'openai/gpt-oss-20b'
const fresh = (s: number, model = MODEL): ReplySample => ({
  model,
  fresh: true,
  s,
})
const answer = (s: number, extra: Record<string, unknown> = {}) =>
  ({
    role: 'assistant',
    content: [],
    metadata: {
      timings: { model_used: MODEL, wait_for_first_byte_s: s, ...extra },
    },
  }) as unknown as ThreadMessage

describe('replySpeed', () => {
  beforeEach(() => localStorage.clear())

  it('remembers fresh-chat answers and skips background tabs', () => {
    recordReply({
      model_used: MODEL,
      history_messages: 2,
      wait_for_first_byte_s: 0.3,
    })
    recordReply({
      model_used: MODEL,
      history_messages: 21,
      wait_for_first_byte_s: 0.9,
    })
    recordReply({
      model_used: MODEL,
      history_messages: 2,
      wait_for_first_byte_s: 5,
      tab_hidden_at_send: true,
    })
    expect(readSamples()).toEqual([
      { model: MODEL, fresh: true, s: 0.3 },
      { model: MODEL, fresh: false, s: 0.9 },
    ])
  })

  it('needs a few fresh answers from the same model for a baseline', () => {
    expect(freshBaseline(MODEL, [fresh(0.3), fresh(0.4)])).toBeUndefined()
    expect(
      freshBaseline(MODEL, [
        fresh(0.3),
        fresh(0.4),
        fresh(2),
        fresh(9, 'other'),
      ])
    ).toBe(0.4)
  })

  it('stays green until answers here really start later', () => {
    const base = [fresh(0.3), fresh(0.3), fresh(0.3)]
    expect(chatDelay([answer(0.4), answer(0.5)], base)?.level).toBe('light')
    expect(
      chatDelay([answer(1.0), answer(1.1), answer(0.9)], base)
    ).toMatchObject({
      level: 'medium',
      delayS: expect.closeTo(0.7),
    })
    // One slow answer alone (a network blip) doesn't turn it red
    expect(chatDelay([answer(0.4), answer(0.4), answer(4)], base)?.level).toBe(
      'light'
    )
    expect(chatDelay([answer(2), answer(2.2), answer(2.5)], base)?.level).toBe(
      'heavy'
    )
  })

  it('says nothing without an answer or a baseline to compare', () => {
    expect(chatDelay([], [fresh(0.3), fresh(0.3), fresh(0.3)])).toBeUndefined()
    expect(chatDelay([answer(3)], [])).toBeUndefined()
  })
})
