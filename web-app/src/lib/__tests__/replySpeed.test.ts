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
const fresh = (s: number, extra: Partial<ReplySample> = {}): ReplySample => ({
  model: MODEL,
  fresh: true,
  s,
  ...extra,
})
const answer = (s: number, extra: Record<string, unknown> = {}) =>
  ({
    role: 'assistant',
    content: [],
    metadata: {
      timings: { model_used: MODEL, wait_for_first_byte_s: s, ...extra },
    },
  }) as unknown as ThreadMessage
const base = [fresh(0.16), fresh(0.15), fresh(0.18)]

describe('replySpeed', () => {
  beforeEach(() => localStorage.clear())

  it('remembers each answer with the provider times, skipping background tabs', () => {
    recordReply({
      model_used: MODEL,
      history_messages: 2,
      wait_for_first_byte_s: 0.16,
      provider_queue_s: 0.01,
      provider_prompt_s: 0.02,
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
      { model: MODEL, fresh: true, s: 0.16, q: 0.01, p: 0.02 },
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
        { model: 'other', fresh: true, s: 9 },
      ])
    ).toBe(0.4)
  })

  it('stays green until answers here really start later', () => {
    expect(chatDelay([answer(0.2), answer(0.3)], base)?.level).toBe('light')
    expect(
      chatDelay([answer(0.6), answer(0.7), answer(0.5)], base)
    ).toMatchObject({
      level: 'medium',
      delayS: expect.closeTo(0.44),
    })
    // One slow answer alone (a network blip) doesn't change it
    expect(chatDelay([answer(0.2), answer(0.2), answer(4)], base)?.level).toBe(
      'light'
    )
    expect(
      chatDelay([answer(1.4), answer(1.5), answer(1.3)], base)?.level
    ).toBe('heavy')
  })

  it("leaves out the provider's queue: a busy Groq is not the chat's fault", () => {
    const busy = [0.9, 1.0, 1.1].map((s) =>
      answer(s, { provider_queue_s: s - 0.17 })
    )
    expect(chatDelay(busy, base)?.level).toBe('light')
  })

  it('says how much of the delay is the model reading the longer chat', () => {
    const withReading = base.map((x) => ({ ...x, p: 0.02 }))
    const long = [0.7, 0.8, 0.75].map((s) =>
      answer(s, { provider_queue_s: 0, provider_prompt_s: 0.22 })
    )
    expect(chatDelay(long, withReading)).toMatchObject({
      level: 'medium',
      readingS: expect.closeTo(0.2),
    })
  })

  it('says nothing without an answer or a baseline to compare', () => {
    expect(chatDelay([], base)).toBeUndefined()
    expect(chatDelay([answer(3)], [])).toBeUndefined()
  })

  it('leaves Auto · Accuracy answers out, whose start includes the web search', () => {
    recordReply({
      model_used: MODEL,
      history_messages: 2,
      wait_for_first_byte_s: 2.5,
      auto_mode: 'accuracy',
    })
    expect(readSamples()).toEqual([])
    const messages = [
      answer(0.16),
      answer(2.5, { auto_mode: 'accuracy' }),
      answer(2.8, { auto_mode: 'accuracy' }),
    ]
    expect(chatDelay(messages, base)?.level).toBe('light')
  })
})
