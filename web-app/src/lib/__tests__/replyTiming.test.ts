import { describe, it, expect } from 'vitest'
import {
  describeTiming,
  speedLogLine,
  trackFetch,
  type FetchAttempt,
} from '../replyTiming'

describe('describeTiming', () => {
  it('names the model that answered as Settings does', () => {
    const req = { messages: 1, chars: 1, tools: 0 }
    expect(
      describeTiming(0, 1, {}, { ...req, model: 'openai/gpt-oss-20b' })
        .answered_by
    ).toBe('Groq gpt-oss-20b')
    expect(
      describeTiming(0, 1, {}, { ...req, model: 'gpt-oss-120b' }).answered_by
    ).toBe('Cerebras gpt-oss-120b')
  })

  it('splits a reply into waiting, thinking and answering', () => {
    const t = describeTiming(
      1000,
      8000,
      {
        firstChunkAt: 5500,
        firstAnswerAt: 7000,
        usage: {
          prompt_tokens: 9000,
          completion_tokens: 700,
          completion_tokens_details: { reasoning_tokens: 500 },
          queue_time: 4.2,
          prompt_time: 0.3,
          completion_time: 0.8,
        },
        providerCreated: 5,
        hiddenAtStart: true,
        hiddenAtFirstChunk: false,
      },
      { messages: 21, chars: 36000, tools: 0 }
    )
    expect(t).toMatchObject({
      total_s: 7,
      wait_for_first_byte_s: 4.5,
      thinking_s: 1.5,
      answer_s: 1,
      history_messages: 21,
      prompt_tokens: 9000,
      reasoning_tokens: 500,
      provider_queue_s: 4.2,
      provider_started_after_s: 4,
      tab_hidden_at_send: true,
      tab_hidden_at_first_byte: false,
    })
  })

  it('leaves stages it never saw empty', () => {
    const t = describeTiming(0, 2000, {}, { messages: 1, chars: 10, tools: 0 })
    expect(t.total_s).toBe(2)
    expect(t.wait_for_first_byte_s).toBeUndefined()
    expect(t.thinking_s).toBeUndefined()
  })

  it('records each request, including retries and their status', async () => {
    const attempts: FetchAttempt[] = []
    const responses = [
      new Response('', { status: 429, headers: { 'retry-after': '7' } }),
      new Response('{}', {
        status: 200,
        headers: { 'x-ratelimit-remaining-tokens': '1200' },
      }),
    ]
    const fetchMock = (async () => responses.shift()!) as typeof fetch
    const tracked = trackFetch(fetchMock, attempts, Date.now())
    await tracked('https://example.test')
    await tracked('https://example.test')
    expect(attempts).toMatchObject([
      { status: 429, retry_after: '7' },
      { status: 200, remaining_tokens: '1200' },
    ])
  })

  it('records a request that fails without a response', async () => {
    const attempts: FetchAttempt[] = []
    const failing = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    await expect(
      trackFetch(failing, attempts, Date.now())('https://example.test')
    ).rejects.toThrow('Failed to fetch')
    expect(attempts[0].error).toBe('Failed to fetch')
  })
})

describe('speedLogLine', () => {
  it('logs timings, route and tab state with no text', () => {
    const t = describeTiming(
      1000,
      2830,
      {
        firstChunkAt: 1210,
        firstAnswerAt: 1420,
        hiddenAtStart: false,
        usage: {
          completion_tokens: 312,
          prompt_tokens: 9100,
          prompt_tokens_details: { cached_tokens: 8960 },
          queue_time: 0.012,
          prompt_time: 0.045,
        },
        attempts: [
          { sent_at_s: 0, headers_after_s: 0.2, status: 200, route: 'direct' },
        ],
      },
      { messages: 3, chars: 40_000, tools: 0, model: 'openai/gpt-oss-20b' }
    )
    expect(speedLogLine(t)).toBe(
      'speed: model=openai_gpt-oss-20b total=1830ms first_byte=210ms first_words=420ms answer=1410ms tokens=312 prompt_tokens=9100 cached=8960 queue=12ms prompt=45ms request=39KB route=direct hidden=no'
    )
  })
  it('adds the Auto mode, thinking level and stop-to-first-word time', () => {
    const t = describeTiming(
      0,
      500,
      { usage: { completion_tokens_details: { reasoning_tokens: 37 } } },
      { messages: 1, chars: 1, tools: 0 }
    )
    expect(
      speedLogLine(t, undefined, {
        mode: 'instant',
        effort: 'low',
        fromStopMs: 812.4,
      })
    ).toMatch(
      / hidden=no mode=instant effort=low reasoning=37 from_stop=812ms$/
    )
    expect(speedLogLine(t, undefined, { mode: 'manual' })).toMatch(
      / mode=manual effort=default reasoning=37 from_stop=none$/
    )
  })
  it('marks missing timings as none', () => {
    const t = describeTiming(0, 500, {}, { messages: 1, chars: 1, tools: 0 })
    expect(speedLogLine(t)).toBe(
      'speed: model=none total=500ms first_byte=none first_words=none answer=none tokens=0 prompt_tokens=0 cached=0 queue=none prompt=none request=0KB route=none hidden=no'
    )
  })
})
