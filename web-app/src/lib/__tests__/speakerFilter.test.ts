import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  requestSpeakerJudge,
  CEREBRAS_CLASSIFIER_MODEL,
  CLASSIFIER_MODELS,
  createRelevanceFilter,
  distinctTranscripts,
  CLASSIFIER_PROMPT,
  CODING_PROMPT,
  JOIN_PROMPT,
  isRepeatOf,
  looksLikeQuestion,
  MERGE_PROMPT,
  pickRelevant,
  isUnsure,
  resetClassifierModel,
  WAIT_PROMPT,
  HISTORY_SECONDS,
  INTERVIEW_PROMPT,
  splitWhy,
  splitType,
  sendsType,
  WHY_PROMPT,
} from '../speakerFilter'

const groqReply = (content: string) =>
  vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  }))

describe('speakerFilter', () => {
  it('falls back from an explicitly unsupported schema and records finish reason', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'response_format json_schema is not supported' }), { status: 400 }))
      .mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"skip"}' }, finish_reason: 'stop' }] })))
    vi.stubGlobal('fetch', fetchMock)
    const config = { apiKey: 'test', baseUrl: 'https://test-schema.invalid', json: true, jsonSchema: { type: 'object' } }
    const result = await requestSpeakerJudge('Return JSON', 'clip', 'clip', config)
    expect(result.finishReason).toBe('stop')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format.type).toBe('json_schema')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).response_format.type).toBe('json_object')
    await requestSpeakerJudge('Return JSON', 'clip', 'clip', config)
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).response_format.type).toBe('json_object')
  })

  it('requests JSON only for structured turns without changing legacy classifiers', async () => {
    const fetchMock = vi.fn(async (_url: string, _options: { body: string }) => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"action":"skip"}' } }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await requestSpeakerJudge('Return JSON', 'clip', 'clip', { apiKey: 'test', json: true })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toEqual({ type: 'json_object' })
    fetchMock.mockClear()
    await requestSpeakerJudge('Return YES or NO', 'clip', 'clip', { apiKey: 'test' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toBeUndefined()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetClassifierModel()
  })

  it('recognises questions and requests locally', () => {
    expect(looksLikeQuestion('Okay. What is a Kubernetes pod?')).toBe(true)
    expect(looksLikeQuestion('Tell me about CI pipelines.')).toBe(true)
    expect(looksLikeQuestion('Thanks, that was great.')).toBe(false)
  })

  it('drops plain chatter without asking the judge', async () => {
    const fetchMock = groqReply('YES')
    vi.stubGlobal('fetch', fetchMock)
    const onCheck = vi.fn()
    expect(
      await pickRelevant(
        ['Okay, okay.', 'Okay. Okay. Yeah.'],
        { apiKey: 'k' },
        [],
        onCheck
      )
    ).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onCheck).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'local chatter rule', ms: 0 })
    )
  })

  it('asks the judge when one engine heard more than chatter', async () => {
    const fetchMock = groqReply('YES')
    vi.stubGlobal('fetch', fetchMock)
    expect(
      await pickRelevant(['Okay.', 'Okay. Why?'], { apiKey: 'k' })
    ).not.toBeNull()
    expect(fetchMock).toHaveBeenCalled()
  })

  it('without a Groq key, only clear questions of five or more words pass', async () => {
    expect(
      await pickRelevant(['How does DNS resolution work here?'])
    ).not.toBeNull()
    expect(await pickRelevant(['Can you hear me?'])).toBeNull()
    expect(await pickRelevant(['Thanks, that was really great.'])).toBeNull()
    expect(await pickRelevant(['   '])).toBeNull()
  })

  it('lets the Groq model decide, even for short questions', async () => {
    const fetchMock = groqReply('YES')
    vi.stubGlobal('fetch', fetchMock)
    expect(
      await pickRelevant(['What is Kubernetes?'], { apiKey: 'k' })
    ).not.toBeNull()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.model).toBe(CLASSIFIER_MODELS[0])
    vi.stubGlobal('fetch', groqReply('NO'))
    expect(
      await pickRelevant(['So you can tell any?'], { apiKey: 'k' })
    ).toBeNull()
  })

  it('sends nothing and reports why when Groq fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    await expect(
      pickRelevant(['What is the plan for the release?'], { apiKey: 'k' })
    ).rejects.toThrow("Couldn't reach Groq")
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429 }))
    )
    await expect(
      pickRelevant(['What is a pod?', 'What is a pot?'], { apiKey: 'k' })
    ).rejects.toThrow('Groq rate limit reached (429)')
  })

  it('passes recent clips as context so follow-ups can be judged', async () => {
    const fetchMock = groqReply('YES')
    vi.stubGlobal('fetch', fetchMock)
    const accept = createRelevanceFilter(() => ({ apiKey: 'k' }))
    await accept(['We moved the database to Postgres last year.'])
    await accept(['And how did that go?'])
    const lastBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(lastBody.messages[1].content).toContain(
      'We moved the database to Postgres last year.'
    )
    expect(lastBody.messages[1].content).toContain(
      'Clip to judge: "And how did that go?"'
    )
  })

  it('judges on Cerebras gpt-oss-120b when it has a key', async () => {
    const fetchMock = groqReply('YES')
    vi.stubGlobal('fetch', fetchMock)
    let model = ''
    expect(
      await pickRelevant(
        ['What is a pod?'],
        { apiKey: 'g', cerebras: { apiKey: 'c' } },
        [],
        (info) => (model = info.model)
      )
    ).toBe('What is a pod?')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string; headers: Record<string, string> },
    ]
    expect(url).toBe('https://api.cerebras.ai/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer c')
    const body = JSON.parse(init.body)
    expect(body.model).toBe(CEREBRAS_CLASSIFIER_MODEL)
    expect(body.reasoning_effort).toBe('low')
    expect(body.include_reasoning).toBeUndefined()
    expect(model).toBe('cerebras/gpt-oss-120b')
  })

  it('uses the judgement model picked in settings', async () => {
    const fetchMock = groqReply('YES')
    vi.stubGlobal('fetch', fetchMock)
    const keys = { apiKey: 'g', cerebras: { apiKey: 'c' } }
    await pickRelevant(['What is a pod?'], { ...keys, judge: 'groq-20b' })
    await pickRelevant(['What is a VNet?'], { ...keys, judge: 'groq-120b' })
    const models = fetchMock.mock.calls.map(
      (call) =>
        JSON.parse((call as unknown as [string, { body: string }])[1].body)
          .model
    )
    expect(models).toEqual(['openai/gpt-oss-20b', 'openai/gpt-oss-120b'])
  })

  it('falls back to Groq when Cerebras fails', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('cerebras')
        ? { ok: false, status: 500 }
        : {
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: 'NO' } }] }),
          }
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(
      await pickRelevant(['So you can tell any?'], {
        apiKey: 'g',
        cerebras: { apiKey: 'c' },
      })
    ).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe(
      CLASSIFIER_MODELS[0]
    )
  })

  it('notes why Cerebras failed', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('cerebras')
        ? { ok: false, status: 429, text: async () => 'queue_exceeded' }
        : {
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: 'YES' } }] }),
          }
    )
    vi.stubGlobal('fetch', fetchMock)
    let note = ''
    await pickRelevant(
      ['What is a pod?'],
      { apiKey: 'g', cerebras: { apiKey: 'c' } },
      [],
      (info) => (note = info.note ?? '')
    )
    expect(note).toBe('Cerebras failed (429): queue_exceeded')
  })

  it('asks Groq too when Cerebras is slow, and takes the first answer', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((url: string, init: { signal: AbortSignal }) =>
      url.includes('cerebras')
        ? new Promise((_, reject) =>
            init.signal.addEventListener('abort', () =>
              reject(new Error('aborted'))
            )
          )
        : Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ choices: [{ message: { content: 'YES' } }] }),
          })
    )
    vi.stubGlobal('fetch', fetchMock)
    let info: { model: string; note?: string } = { model: '' }
    const verdict = pickRelevant(
      ['What is a pod?'],
      { apiKey: 'g', cerebras: { apiKey: 'c' } },
      [],
      (i) => (info = i)
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(await verdict).toBe('What is a pod?')
    vi.useRealTimers()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(info.model).toBe(CLASSIFIER_MODELS[0])
    expect(info.note).toBe('Cerebras slower than 1 s; Groq answered first')
    // The slow Cerebras request is stopped.
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  })

  const claudeReply = (text: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }] }),
  })
  const cerebrasYes = {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'YES' } }] }),
  }
  const allKeys = {
    apiKey: 'g',
    cerebras: { apiKey: 'c' },
    anthropic: { apiKey: 'a', baseUrl: 'https://api.anthropic.com/v1' },
  }

  it('offers a clip the two judges disagree on, and decides when they agree', async () => {
    const both = (cerebras: string, claude: string) =>
      vi.fn(async (url: string) =>
        url.includes('anthropic')
          ? claudeReply(claude)
          : {
              ok: true,
              status: 200,
              json: async () => ({
                choices: [{ message: { content: cerebras } }],
              }),
            }
      )
    const config = {
      ...allKeys,
      judge: 'cerebras-120b' as const,
      secondJudge: 'claude-haiku' as const,
    }
    let note = ''
    vi.stubGlobal('fetch', both('YES', 'NO'))
    expect(
      await pickRelevant(['Can you show me?'], config, [], (i) => {
        note = i.note ?? ''
      })
    ).toEqual({ unsure: 'Can you show me?' })
    expect(note).toContain('Judges disagree')
    vi.stubGlobal('fetch', both('NO', 'YES'))
    expect(await pickRelevant(['Can you show me?'], config)).toEqual({
      unsure: 'Can you show me?',
    })
    vi.stubGlobal('fetch', both('YES', 'YES'))
    expect(await pickRelevant(['What is a pod?'], config)).toBe(
      'What is a pod?'
    )
    vi.stubGlobal('fetch', both('NO', 'NO'))
    expect(await pickRelevant(['Scroll up.'], config)).toBeNull()
  })

  it('goes with the first judge when the second one fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('anthropic')
          ? { ok: false, status: 529, text: async () => 'overloaded' }
          : cerebrasYes
      )
    )
    // Claude failing falls back to Cerebras, which agrees: sent
    expect(
      await pickRelevant(['What is a pod?'], {
        ...allKeys,
        judge: 'cerebras-120b',
        secondJudge: 'claude-haiku',
      })
    ).toBe('What is a pod?')
  })

  it('judges with Claude Haiku straight from the browser', async () => {
    const fetchMock = vi.fn(async () => claudeReply('YES'))
    vi.stubGlobal('fetch', fetchMock)
    let model = ''
    expect(
      await pickRelevant(
        ['What is a pod?'],
        { ...allKeys, judge: 'claude-haiku' },
        [],
        (info) => (model = info.model)
      )
    ).toBe('What is a pod?')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string; headers: Record<string, string> },
    ]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('a')
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe(
      'true'
    )
    const body = JSON.parse(init.body)
    expect(body.model).toBe('claude-haiku-4-5')
    expect(body.temperature).toBe(0)
    expect(body.system[0].text).toContain(CLASSIFIER_PROMPT)
    expect(model).toBe('anthropic/claude-haiku-4-5')
  })

  it('runs Claude Sonnet 5.5 without thinking and without sampling settings', async () => {
    const fetchMock = vi.fn(async () => claudeReply('NO'))
    vi.stubGlobal('fetch', fetchMock)
    expect(
      await pickRelevant(['Is that clear?'], {
        ...allKeys,
        judge: 'claude-sonnet',
      })
    ).toBeNull()
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body
    )
    expect(body.model).toBe('claude-sonnet-5-5')
    expect(body.thinking).toEqual({ type: 'between_tools' })
    expect(body.output_config).toEqual({ effort: 'low' })
    expect(body.temperature).toBeUndefined()
  })

  it('falls back to Cerebras when Claude fails', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('anthropic')
        ? { ok: false, status: 529, text: async () => 'overloaded' }
        : cerebrasYes
    )
    vi.stubGlobal('fetch', fetchMock)
    let info: { model: string; note?: string } = { model: '' }
    expect(
      await pickRelevant(
        ['What is a pod?'],
        { ...allKeys, judge: 'claude-haiku' },
        [],
        (i) => (info = i)
      )
    ).toBe('What is a pod?')
    expect(info.model).toBe('cerebras/gpt-oss-120b')
    expect(info.note).toBe('Claude failed (529): overloaded')
  })

  it('uses Cerebras when a Claude judge has no Anthropic key', async () => {
    const fetchMock = vi.fn(async () => cerebrasYes)
    vi.stubGlobal('fetch', fetchMock)
    let note = ''
    await pickRelevant(
      ['What is a pod?'],
      { apiKey: 'g', cerebras: { apiKey: 'c' }, judge: 'claude-sonnet' },
      [],
      (i) => (note = i.note ?? '')
    )
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain(
      'cerebras'
    )
    expect(note).toBe('No Anthropic key; used Cerebras')
  })

  it('asks Cerebras too when Claude is slow, and takes the first answer', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((url: string, init: { signal: AbortSignal }) =>
      url.includes('anthropic')
        ? new Promise((_, reject) =>
            init.signal.addEventListener('abort', () =>
              reject(new Error('aborted'))
            )
          )
        : Promise.resolve(cerebrasYes)
    )
    vi.stubGlobal('fetch', fetchMock)
    let info: { model: string; note?: string } = { model: '' }
    const verdict = pickRelevant(
      ['What is a pod?'],
      { ...allKeys, judge: 'claude-haiku' },
      [],
      (i) => (info = i)
    )
    await vi.advanceTimersByTimeAsync(1500)
    expect(await verdict).toBe('What is a pod?')
    vi.useRealTimers()
    expect(info.model).toBe('cerebras/gpt-oss-120b')
    expect(info.note).toBe(
      'Claude slower than 1.5 s; cerebras/gpt-oss-120b answered first'
    )
    // The slow Claude request is stopped.
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it('lets Cerebras think more when picked', async () => {
    const fetchMock = groqReply('YES')
    vi.stubGlobal('fetch', fetchMock)
    let model = ''
    await pickRelevant(
      ['What is a pod?'],
      { apiKey: 'g', cerebras: { apiKey: 'c' }, judge: 'cerebras-120b-think' },
      [],
      (i) => (model = i.model)
    )
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body
    )
    expect(body.reasoning_effort).toBe('medium')
    expect(body.max_tokens).toBe(1800)
    expect(model).toBe('cerebras/gpt-oss-120b (medium)')
  })

  it('keeps the reason out of the question', () => {
    expect(splitWhy('YES: What is a pod?\nWhy: a direct question')).toEqual([
      'YES: What is a pod?',
      'a direct question',
    ])
    expect(splitWhy('NO Why: screen commentary')).toEqual([
      'NO',
      'screen commentary',
    ])
    expect(splitWhy('YES')).toEqual(['YES', ''])
  })

  it('takes the type line out of the answer', () => {
    expect(splitType('YES: What is a pod?\nType: question')).toEqual([
      'YES: What is a pod?',
      'question',
    ])
    expect(splitType('NO\nType: Logistics (screen)')).toEqual([
      'NO',
      'logistics',
    ])
    expect(splitType('YES Type: task')).toEqual(['YES', 'task'])
    expect(splitType('YES: Which type: int or long?')).toEqual([
      'YES: Which type: int or long?',
      '',
    ])
    expect(splitType('YES')).toEqual(['YES', ''])
  })

  it('lists every clip type in the instructions', () => {
    for (const t of ['question', 'task', 'follow-up', 'repeat', 'logistics'])
      expect(WHY_PROMPT).toContain(`- ${t}:`)
    expect(sendsType('task')).toBe(true)
    expect(sendsType('confirmation')).toBe(false)
    expect(sendsType('banana')).toBeUndefined()
  })

  it('drops a YES the judge typed as a skip type', async () => {
    vi.stubGlobal(
      'fetch',
      groqReply('YES\nType: logistics\nWhy: asks to open the chat')
    )
    const onCheck = vi.fn()
    expect(
      await pickRelevant(
        ['Can you please go to the chat?'],
        { apiKey: 'k' },
        [],
        onCheck
      )
    ).toBeNull()
    expect(onCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'logistics',
        note: expect.stringContaining('type: logistics (overrode yes)'),
      })
    )
  })

  it('does not let MORE bypass a logistics veto', async () => {
    vi.stubGlobal(
      'fetch',
      groqReply(
        'MORE: What is DNS? Can you open the shared document now?\nType: logistics'
      )
    )
    expect(
      await pickRelevant(['Can you open the shared document now?'], {
        apiKey: 'test',
      })
    ).toBeNull()
  })

  it('keeps a NO even when the judge typed it as a send type', async () => {
    vi.stubGlobal('fetch', groqReply('NO\nType: task\nWhy: a screen request'))
    expect(
      await pickRelevant(['Can you write that?'], { apiKey: 'k' })
    ).toBeNull()
  })

  it('with clip types off, asks for no type and ignores one', async () => {
    const fetchMock = groqReply('YES\nType: logistics')
    vi.stubGlobal('fetch', fetchMock)
    expect(
      await pickRelevant(['What is a Kubernetes pod?'], {
        apiKey: 'k',
        clipTypes: false,
      })
    ).toBe('What is a Kubernetes pod?')
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body
    )
    expect(body.messages[0].content).not.toContain('Type: ')
  })

  it('keeps WAIT and the answer when the type is unknown', async () => {
    vi.stubGlobal('fetch', groqReply('YES\nType: banana'))
    expect(
      await pickRelevant(['What is a Kubernetes pod?'], { apiKey: 'k' })
    ).toBe('What is a Kubernetes pod?')
    vi.stubGlobal('fetch', groqReply('WAIT\nType: fragment'))
    expect(
      await pickRelevant(
        ['Can you explain how you would'],
        { apiKey: 'k' },
        [],
        undefined,
        'wait'
      )
    ).toEqual({ wait: 'Can you explain how you would' })
  })

  it('offers an unsure clip through the filter instead of sending it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('anthropic')
          ? {
              ok: true,
              status: 200,
              json: async () => ({ content: [{ type: 'text', text: 'NO' }] }),
            }
          : {
              ok: true,
              status: 200,
              json: async () => ({
                choices: [{ message: { content: 'YES' } }],
              }),
            }
      )
    )
    const offered: string[] = []
    const filter = createRelevanceFilter(
      () => ({
        apiKey: 'g',
        cerebras: { apiKey: 'c' },
        anthropic: { apiKey: 'a' },
        secondJudge: 'claude-haiku',
      }),
      undefined,
      Date.now,
      { enabled: () => false, onUnsure: (t) => offered.push(t) }
    )
    expect(
      await filter(['Can you write that function for the list now, please?'])
    ).toBeNull()
    expect(offered).toEqual([
      'Can you write that function for the list now, please?',
    ])
    expect(isUnsure({ unsure: 'x' })).toBe(true)
    // Sent with a tap: a repeat of it is skipped from then on
    filter.markSent('Can you write that function for the list now, please?')
    expect(await filter(['Can you write that function for the list now, please?'])).toBeNull()
    expect(offered).toHaveLength(1)
  })

  it('logs the reason and sends only the question', async () => {
    vi.stubGlobal(
      'fetch',
      groqReply('YES: What is a pod?\nWhy: asks a concept')
    )
    let note = ''
    const verdict = await pickRelevant(
      ['What is a pod?', 'What is a pot?'],
      { apiKey: 'g' },
      [],
      (i) => (note = i.note ?? '')
    )
    expect(verdict).toBe('What is a pod?')
    expect(note).toBe('why: asks a concept')
  })

  it('shows earlier clips to Cerebras and Claude, and only recent clips to Groq', async () => {
    const at = new Date(2026, 9, 7, 14, 5).getTime()
    const recent = Array.from({ length: 9 }, (_, i) => ({
      text: `Clip ${i}`,
      sent: i === 1,
      at,
      ago: 60,
    }))
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('anthropic') ? claudeReply('NO') : cerebrasYes
    )
    vi.stubGlobal('fetch', fetchMock)
    await pickRelevant(
      ['Is that clear?'],
      { apiKey: 'g', cerebras: { apiKey: 'c' } },
      recent
    )
    await pickRelevant(['Is that clear?'], { apiKey: 'g' }, recent)
    await pickRelevant(
      ['Is that clear?'],
      { ...allKeys, judge: 'claude-sonnet' },
      recent
    )
    const bodies = fetchMock.mock.calls.map((c) =>
      JSON.parse((c as unknown as [string, { body: string }])[1].body)
    )
    const cerebrasUser = bodies[0].messages[1].content
    expect(bodies[0].messages[0].content).toContain(INTERVIEW_PROMPT)
    expect(cerebrasUser).toContain('Earlier in this interview')
    expect(cerebrasUser).toContain('- [14:05, sent] Clip 1')
    // Clip 1 is earlier, so no recent clip is marked as sent
    expect(cerebrasUser).not.toContain('[sent 60 s ago]')
    const groqUser = bodies[1].messages[1].content
    expect(groqUser).not.toContain('Earlier in this interview')
    expect(groqUser).toContain('Clip 8')
    // Claude: one block per earlier clip, cached up to the last one
    const blocks = bodies[2].messages[0].content
    expect(blocks).toHaveLength(4)
    expect(blocks[2].cache_control).toEqual({ type: 'ephemeral' })
    expect(blocks[3].text).toContain('Recent clips')
  })

  it('shows the judge only the last 5 minutes of the interview', async () => {
    const at = new Date(2026, 9, 7, 14, 5).getTime()
    const recent = [
      { text: 'Old question', sent: true, at, ago: HISTORY_SECONDS + 1 },
      { text: 'Edge question', sent: true, at, ago: HISTORY_SECONDS },
      ...Array.from({ length: 6 }, (_, i) => ({
        text: `Clip ${i}`,
        sent: false,
        at,
        ago: 30,
      })),
    ]
    const fetchMock = vi.fn(async () => cerebrasYes)
    vi.stubGlobal('fetch', fetchMock)
    await pickRelevant(
      ['Is that clear?'],
      { apiKey: 'g', cerebras: { apiKey: 'c' } },
      recent
    )
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body
    )
    const user = body.messages[1].content
    expect(user).toContain('Edge question')
    expect(user).not.toContain('Old question')
  })

  it('leaves out the interview prompt when every earlier clip is too old', async () => {
    const recent = [
      { text: 'Old question', sent: true, ago: HISTORY_SECONDS + 60 },
      ...Array.from({ length: 6 }, (_, i) => ({
        text: `Clip ${i}`,
        sent: false,
        ago: 30,
      })),
    ]
    const fetchMock = vi.fn(async () => cerebrasYes)
    vi.stubGlobal('fetch', fetchMock)
    await pickRelevant(
      ['Is that clear?'],
      { apiKey: 'g', cerebras: { apiKey: 'c' } },
      recent
    )
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body
    )
    expect(body.messages[0].content).not.toContain(INTERVIEW_PROMPT)
    expect(body.messages[1].content).not.toContain('Earlier in this interview')
  })

  it('tells the merge judge to keep setup sentences', () => {
    expect(MERGE_PROMPT).toContain(
      'Never cut the question down to its last sentence'
    )
  })

  it('treats transcripts that differ only in punctuation as one', () => {
    expect(
      distinctTranscripts(['What is a pod?', 'what is a pod', 'What is a Pod.'])
    ).toEqual(['What is a pod?'])
  })

  it('sends the whole clip when the judge keeps only the last sentence', async () => {
    const eleven =
      'So, when you create a subnet, there is no option to create a private subnet or a public subnet, right? So, I wanted to understand the configuration. How would you make your subnet a public or a private one?'
    const grok = eleven.replace('So, when', 'So when')
    vi.stubGlobal(
      'fetch',
      groqReply(
        'YES: How would you make your subnet a public or a private one?'
      )
    )
    expect(await pickRelevant([eleven, grok], { apiKey: 'k' })).toBe(eleven)
  })

  it('keeps a merge that only drops filler', async () => {
    vi.stubGlobal(
      'fetch',
      groqReply(
        'YES: Okay, fine. Have you worked with hybrid networking in AWS?'
      )
    )
    expect(
      await pickRelevant(
        [
          'All right. Okay. Yeah. Okay, fine. Have you worked with hybrid networking in AWS?',
          'College. Okay. Okay, fine. Have you worked with hybrid networking in AWS?',
        ],
        { apiKey: 'k' }
      )
    ).toBe('Okay, fine. Have you worked with hybrid networking in AWS?')
  })

  it('tells the judge about tasks, scenarios and call logistics', () => {
    expect(CLASSIFIER_PROMPT).toContain("An interviewer's task or exercise")
    expect(CLASSIFIER_PROMPT).toContain('share your screen now?" -> NO')
    expect(WAIT_PROMPT).toContain('sets up a scenario')
  })

  it('skips screen-share chatter and adds coding rules only in coding mode', async () => {
    expect(CLASSIFIER_PROMPT).toContain('open an online compiler?" -> NO')
    const fetchMock = groqReply('NO')
    vi.stubGlobal('fetch', fetchMock)
    const system = (i: number) =>
      JSON.parse(
        (fetchMock.mock.calls[i] as unknown as [string, { body: string }])[1]
          .body
      ).messages[0].content
    await pickRelevant(['What happened?'], { apiKey: 'k' })
    await pickRelevant(['What happened?'], { apiKey: 'k', coding: true })
    expect(system(0)).not.toContain(CODING_PROMPT)
    expect(system(1)).toContain(CODING_PROMPT)
    // Late additions still join while coding mode is on.
    expect(system(1)).toContain(JOIN_PROMPT)
  })

  it('in coding mode, joins a correction spread over unsent clips', async () => {
    vi.stubGlobal(
      'fetch',
      groqReply(
        'YES: It is repeated two times. Not T-H-I-S, I-S. I want you to show two times.'
      )
    )
    expect(
      await pickRelevant(
        ['I want you to show two times.'],
        { apiKey: 'k', coding: true },
        [
          { text: 'It is repeated two times.', sent: false },
          { text: 'Not T-H-I-S, I-S.', sent: false },
        ]
      )
    ).toBe(
      'It is repeated two times. Not T-H-I-S, I-S. I want you to show two times.'
    )
    // Outside coding mode a plain clip is sent as heard
    vi.stubGlobal('fetch', groqReply('YES: something else entirely'))
    expect(
      await pickRelevant(['I want you to show two times.'], { apiKey: 'k' })
    ).toBe('I want you to show two times.')
  })

  it('gives the merge judge the key terms', async () => {
    const fetchMock = groqReply('YES: Where is the NAT gateway?')
    vi.stubGlobal('fetch', fetchMock)
    await pickRelevant(
      ['Where is the navigate where?', 'Where is the NAT gateway?'],
      { apiKey: 'k', keyterms: ['NAT gateway', 'VPC'] }
    )
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body
    )
    expect(body.messages[1].content).toContain(
      'Key terms the speaker may use: NAT gateway, VPC'
    )
  })

  it('gives the merge judge the coding terms after the assistant ones', async () => {
    const fetchMock = groqReply('YES: Explain bubble sort.')
    vi.stubGlobal('fetch', fetchMock)
    await pickRelevant(['Explain bubble shot.', 'Explain bubble sort.'], {
      apiKey: 'k',
      keyterms: ['Python', 'Bubble Sort'],
    })
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body
    )
    const content: string = body.messages[1].content
    expect(content).toContain(
      'Key terms the speaker may use: Python, Bubble Sort, sorting, insertion sort'
    )
    const line = content.split('\n').find((l) => l.startsWith('Key terms'))
    expect(line?.match(/bubble sort/gi)).toHaveLength(1)
  })

  it('uses a plain YES/NO check when both engines agree', async () => {
    const fetchMock = groqReply('YES')
    vi.stubGlobal('fetch', fetchMock)
    expect(
      await pickRelevant(['What is a pod?', 'What is a pod'], { apiKey: 'k' })
    ).toBe('What is a pod?')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    // Room for a joined question, plus gpt-oss's short reasoning
    expect(body.max_tokens).toBe(600)
    expect(body.reasoning_effort).toBe('low')
  })

  it('merges two differing transcripts in the same Groq call', async () => {
    const fetchMock = groqReply('YES: How do you scale a Kubernetes cluster?')
    vi.stubGlobal('fetch', fetchMock)
    expect(
      await pickRelevant(
        [
          'How do you scale a Cooper Nettie cluster?',
          'How do you scale a Kubernetes cluster?',
        ],
        { apiKey: 'k' }
      )
    ).toBe('How do you scale a Kubernetes cluster?')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[1].content).toContain(
      'A: "How do you scale a Cooper Nettie cluster?"'
    )
    expect(body.messages[1].content).toContain(
      'B: "How do you scale a Kubernetes cluster?"'
    )
  })

  it('drops a clip both engines heard when Groq says NO', async () => {
    vi.stubGlobal('fetch', groqReply('NO'))
    expect(
      await pickRelevant(['So you can tell any?', 'So you can tell, any?!'], {
        apiKey: 'k',
      })
    ).toBe(null)
  })

  it('falls back to the first text if the model answers instead of copying', async () => {
    vi.stubGlobal(
      'fetch',
      groqReply(
        'YES: A pod is the smallest deployable unit in Kubernetes. It groups one or more containers that share storage and network, and it is scheduled onto a node as a whole.'
      )
    )
    expect(
      await pickRelevant(['What is a pod?', 'What is a pot?'], { apiKey: 'k' })
    ).toBe('What is a pod?')
  })

  it('moves to the next model when Groq no longer serves one, and keeps it', async () => {
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const { model } = JSON.parse(init.body)
      if (model === CLASSIFIER_MODELS[0]) return { ok: false, status: 404 }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'YES' } }] }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(
      await pickRelevant(['What is a pod?'], { apiKey: 'k' })
    ).not.toBeNull()
    const second = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(second.model).toBe('openai/gpt-oss-120b')
    expect(second.reasoning_effort).toBe('low')
    expect(
      await pickRelevant(['And how is it scheduled?'], { apiKey: 'k' })
    ).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).model).toBe(
      'openai/gpt-oss-120b'
    )
  })

  it('reports which model judged the clip and how long it took', async () => {
    vi.stubGlobal('fetch', groqReply('YES'))
    const onCheck = vi.fn()
    const accept = createRelevanceFilter(() => ({ apiKey: 'k' }), onCheck)
    expect(await accept(['What is a pod?'])).toBe('What is a pod?')
    expect(onCheck).toHaveBeenCalledWith({
      model: CLASSIFIER_MODELS[0],
      ms: expect.any(Number),
    })
  })

  it('marks a joined question as replacing the one sent just before', async () => {
    let clock = 0
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'YES' } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  'YES: How will you extract the token? It could be a bearer token.',
              },
            },
          ],
        }),
      })
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'YES' } }],
        }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const accept = createRelevanceFilter(
      () => ({ apiKey: 'k' }),
      undefined,
      () => clock
    )
    const first = await accept(['How will you extract the token?'])
    expect(accept.takeRevision(first!)).toBe(false)
    clock += 10_000
    const joined = await accept(['It could be a bearer token.'])
    expect(joined).toBe(
      'How will you extract the token? It could be a bearer token.'
    )
    expect(accept.takeRevision(joined!)).toBe(true)
    // Only once
    expect(accept.takeRevision(joined!)).toBe(false)
    // A separate question later is a new one
    clock += 60_000
    const next = await accept(['What is a Kubernetes pod?'])
    expect(accept.takeRevision(next!)).toBe(false)
  })

  it('replaces the question just sent when the judge says MORE', async () => {
    let clock = 0
    const replies = [
      'YES',
      'MORE: Why do you require a Transit Gateway? Or maybe why is it required at all, when we have VPC peering?',
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: replies.shift() ?? 'YES' } }],
        }),
      }))
    )
    const checks: { note?: string }[] = []
    const accept = createRelevanceFilter(
      () => ({ apiKey: 'k' }),
      (info) => checks.push(info),
      () => clock
    )
    await accept(['Why do you require a Transit Gateway?'])
    clock += 9_000
    const text = await accept([
      'Or maybe why is it required at all, when we have VPC peering?',
    ])
    expect(text).toBe(
      'Why do you require a Transit Gateway? Or maybe why is it required at all, when we have VPC peering?'
    )
    expect(accept.takeRevision(text!)).toBe(true)
    expect(checks.at(-1)?.note).toContain('Replaces the question just sent')
  })

  it('sends MORE as a plain question when nothing was sent recently', async () => {
    vi.stubGlobal('fetch', groqReply('MORE: What is a pod? And a service?'))
    const accept = createRelevanceFilter(() => ({ apiKey: 'k' }))
    const text = await accept(['And a service?'])
    expect(text).toBe('What is a pod? And a service?')
    expect(accept.takeRevision(text!)).toBe(false)
  })

  const FULL =
    'When you create a subnet, there is no option to create a private or public subnet, right? So what is that configuration? How would you make your subnet a public or a private one?'

  it('spots a clip that repeats the end of an earlier question', () => {
    expect(
      isRepeatOf(
        'What is that configuration? How would you make your subnet a public or a private one?',
        FULL
      )
    ).toBe(true)
    expect(
      isRepeatOf('How do route tables work with NAT gateways?', FULL)
    ).toBe(false)
    // Short follow-ups are left to the classifier
    expect(isRepeatOf('Why public?', FULL)).toBe(false)
    expect(
      isRepeatOf(
        'Why is that? Can you explain?',
        "Sorry, I didn't get that. Can you please explain in a simple way why both are true?"
      )
    ).toBe(false)
  })

  it('skips a repeat of a question sent recently, without asking Groq', async () => {
    const fetchMock = groqReply('YES')
    vi.stubGlobal('fetch', fetchMock)
    let clock = 0
    const checks: { note?: string }[] = []
    const accept = createRelevanceFilter(
      () => ({ apiKey: 'k' }),
      (info) => checks.push(info),
      () => clock
    )
    expect(await accept([FULL])).toBe(FULL)
    const repeat =
      'What is that configuration? How would you make your subnet a public or a private one?'
    expect(await accept([repeat])).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(checks[1].note).toMatch(/repeat/)
    // After two minutes the same question counts as new
    clock = 3 * 60 * 1000
    expect(await accept([repeat])).toBe(repeat)
  })

  it('on a bare YES sends the transcript with the most key terms', async () => {
    vi.stubGlobal('fetch', groqReply('YES'))
    expect(
      await pickRelevant(
        [
          'How you integrate Gemstone with Jenkins?',
          'How you integrate JMeter with Jenkins?',
        ],
        { apiKey: 'k', keyterms: ['JMeter', 'Jenkins'] }
      )
    ).toBe('How you integrate JMeter with Jenkins?')
  })

  it('joins a late addition to the question it belongs to', async () => {
    vi.stubGlobal(
      'fetch',
      groqReply('YES: Are you doing some A/B testing? Using JMeter.')
    )
    expect(
      await pickRelevant(['Using JMeter.'], { apiKey: 'k' }, [
        { text: 'Are you doing some A/B testing?', sent: true, ago: 2 },
      ])
    ).toBe('Are you doing some A/B testing? Using JMeter.')
    // A "join" that drops the clip's own words is not trusted
    vi.stubGlobal('fetch', groqReply('YES: Are you doing some A/B testing?'))
    expect(
      await pickRelevant(['Using JMeter.'], { apiKey: 'k' }, [
        { text: 'Are you doing some A/B testing?', sent: true, ago: 2 },
      ])
    ).toBe('Using JMeter.')
  })

  it('tells the judge how long ago each question was sent', async () => {
    const fetchMock = groqReply('YES')
    vi.stubGlobal('fetch', fetchMock)
    let t = 1_000_000
    const accept = createRelevanceFilter(
      () => ({ apiKey: 'k' }),
      undefined,
      () => t
    )
    await accept(['Explain me JMeter.'])
    t += 3000
    await accept(['Main components.'])
    const body = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(body.messages[1].content).toContain(
      '- [sent 3 s ago] Explain me JMeter.'
    )
    expect(body.messages[0].content).toContain(JOIN_PROMPT)
  })

  it('sends everything since the last sent question with takeScenario', async () => {
    vi.stubGlobal('fetch', groqReplies('YES', 'NO', 'NO', 'NO'))
    const accept = createRelevanceFilter(() => ({ apiKey: 'k' }))
    await accept(['You have to extract token, okay?'])
    expect(accept.takeScenario()).toBe(null)
    await accept(['So let us say this is a token response.'])
    await accept(['How will you extract the token?'])
    await accept(['It could be a bearer token.'])
    expect(accept.takeScenario()).toBe(
      'So let us say this is a token response. How will you extract the token? It could be a bearer token.'
    )
    expect(accept.takeScenario()).toBe(null)
  })

  it('marks questions already sent in the context given to Groq', async () => {
    const fetchMock = groqReply('YES')
    vi.stubGlobal('fetch', fetchMock)
    const accept = createRelevanceFilter(() => ({ apiKey: 'k' }))
    await accept(['What is a Kubernetes pod?'])
    await accept(['And how is it scheduled?'])
    const body = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(body.messages[1].content).toContain(
      '- [sent 0 s ago] What is a Kubernetes pod?'
    )
  })

  // Replies in turn; the last one repeats.
  const groqReplies = (...contents: string[]) => {
    let i = 0
    return vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: contents[Math.min(i++, contents.length - 1)] },
          },
        ],
      }),
    }))
  }

  it('only offers WAIT when waiting is switched on', async () => {
    const fetchMock = groqReply('WAIT')
    vi.stubGlobal('fetch', fetchMock)
    const accept = createRelevanceFilter(() => ({ apiKey: 'k' }))
    expect(await accept(['Can you explain how you would'])).toBeNull()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].content).not.toContain('WAIT')
  })

  it('holds an unfinished question and joins it to the next clip', async () => {
    const fetchMock = groqReplies('WAIT', 'YES')
    vi.stubGlobal('fetch', fetchMock)
    const notes: (string | undefined)[] = []
    const accept = createRelevanceFilter(
      () => ({ apiKey: 'k' }),
      (info) => notes.push(info.note),
      Date.now,
      { enabled: () => true }
    )
    expect(await accept(['So when you designed the'])).toBeNull()
    expect(notes).toContain('Waiting for the rest of the question')
    expect(await accept(['payment service, how did you handle retries?'])).toBe(
      'So when you designed the payment service, how did you handle retries?'
    )
    expect(notes).toContain('Joined with the clip before')
    const first = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(first.messages[0].content).toContain('WAIT')
    const second = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(second.messages[1].content).toContain(
      'Clip to judge: "So when you designed the payment service'
    )
    accept.stop()
  })

  it('judges a held clip alone when nothing follows, and sends it late', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = groqReplies('WAIT', 'YES')
      vi.stubGlobal('fetch', fetchMock)
      const late = vi.fn()
      let busy = true
      const accept = createRelevanceFilter(
        () => ({ apiKey: 'k' }),
        undefined,
        Date.now,
        { enabled: () => true, busy: () => busy, onLate: late, holdMs: 4000 }
      )
      expect(await accept(['Tell me about your last project'])).toBeNull()
      // Still talking: keep waiting
      await vi.advanceTimersByTimeAsync(4000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      busy = false
      await vi.advanceTimersByTimeAsync(1000)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const body = JSON.parse(fetchMock.mock.calls[1][1].body)
      expect(body.messages[0].content).toContain('nothing more is coming')
      expect(late).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Tell me about your last project',
          sent: true,
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('a held question judged late still goes out before a newer one', async () => {
    vi.useFakeTimers()
    try {
      // The held clip's own judgement is slow; the next clip's is quick
      let answerHeld!: () => void
      const reply = (content: string) => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content } }] }),
      })
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(reply('WAIT'))
        .mockImplementationOnce(
          () => new Promise((r) => (answerHeld = () => r(reply('YES'))))
        )
        .mockResolvedValue(reply('YES'))
      vi.stubGlobal('fetch', fetchMock)
      const order: string[] = []
      const accept = createRelevanceFilter(
        () => ({ apiKey: 'k' }),
        undefined,
        Date.now,
        {
          enabled: () => true,
          onLate: (clip) => clip.sent && order.push(clip.text),
          holdMs: 4000,
        }
      )
      expect(await accept(['Tell me about your last project'])).toBeNull()
      await vi.advanceTimersByTimeAsync(4000)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const newer = accept([
        'How do you size an EKS cluster for a spike?',
      ]).then((text) => text && order.push(text))
      await vi.advanceTimersByTimeAsync(0)
      answerHeld()
      await newer
      expect(order).toEqual([
        'Tell me about your last project',
        'How do you size an EKS cluster for a spike?',
      ])
      accept.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a held question asked again while it waited is not sent twice', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', groqReplies('WAIT', 'YES'))
      const late = vi.fn()
      const accept = createRelevanceFilter(
        () => ({ apiKey: 'k' }),
        undefined,
        Date.now,
        { enabled: () => true, onLate: late, holdMs: 4000 }
      )
      const question =
        'How would you migrate a monolith to microservices on EKS'
      expect(await accept([question])).toBeNull()
      accept.markSent(`${question}?`)
      await vi.advanceTimersByTimeAsync(4000)
      expect(late).toHaveBeenCalledWith(
        expect.objectContaining({ text: question, sent: false })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a held clip when listening stops', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = groqReply('WAIT')
      vi.stubGlobal('fetch', fetchMock)
      const late = vi.fn()
      const accept = createRelevanceFilter(
        () => ({ apiKey: 'k' }),
        undefined,
        Date.now,
        { enabled: () => true, onLate: late }
      )
      await accept(['So what about the'])
      accept.stop()
      await vi.advanceTimersByTimeAsync(10000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(late).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  describe('Smart Turn', () => {
    const midTurn = { probability: 0.1, ms: 30 }
    const done = { probability: 0.9, ms: 30 }
    const smartFilter = (
      fetchMock: ReturnType<typeof groqReply>,
      late = vi.fn(),
      on = true
    ) => {
      vi.stubGlobal('fetch', fetchMock)
      const notes: (string | undefined)[] = []
      const accept = createRelevanceFilter(
        () => ({ apiKey: 'k' }),
        (info) => notes.push(info.note),
        Date.now,
        { enabled: () => false, onLate: late, smartTurn: () => on }
      )
      return { accept, notes, late }
    }

    it('sends at once when the turn sounds finished', async () => {
      const { accept } = smartFilter(groqReply('YES'))
      expect(await accept(['What is a pod?'], done)).toBe('What is a pod?')
      accept.stop()
    })

    it('sends at once when the switch is off', async () => {
      const { accept } = smartFilter(groqReply('YES'), vi.fn(), false)
      expect(await accept(['What is a pod?'], midTurn)).toBe('What is a pod?')
      accept.stop()
    })

    it('holds a question while mid-turn, then sends it without judging again', async () => {
      vi.useFakeTimers()
      try {
        const fetchMock = groqReply('YES')
        const { accept, notes, late } = smartFilter(fetchMock)
        expect(
          await accept(['How did you handle retries?'], midTurn)
        ).toBeNull()
        expect(notes).toContain('Speaker mid-turn: waiting for the rest')
        expect(accept.holding()).toBe(true)
        await vi.advanceTimersByTimeAsync(5000)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(late).toHaveBeenCalledWith(
          expect.objectContaining({
            text: 'How did you handle retries?',
            sent: true,
          })
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('joins the rest of the question to the held part', async () => {
      const fetchMock = groqReplies('YES', 'YES')
      const { accept } = smartFilter(fetchMock)
      expect(await accept(['So for the payment service,'], midTurn)).toBeNull()
      expect(await accept(['how did you handle retries?'], done)).toBe(
        'So for the payment service, how did you handle retries?'
      )
      accept.stop()
    })

    it('still sends the held question when what follows is skipped', async () => {
      const { accept, notes } = smartFilter(groqReplies('YES', 'NO'))
      expect(await accept(['How do you scale it?'], midTurn)).toBeNull()
      expect(await accept(['Okay.'], done)).toBe('How do you scale it?')
      expect(notes.join(' ')).toContain(
        'Sent the question held before this clip'
      )
      accept.stop()
    })

    it('never glues the answer that follows onto a held question', async () => {
      const fetchMock = groqReplies('YES', 'NO')
      const { accept, notes } = smartFilter(fetchMock)
      expect(
        await accept(['What are your day-to-day activities?'], midTurn)
      ).toBeNull()
      expect(
        await accept(['So basically at 9:30 we have a scrum call'], midTurn)
      ).toBe('What are your day-to-day activities?')
      expect(notes.join(' ')).toContain(
        'Sent the question held before this clip'
      )
      // The answer was judged on its own, with the question before it
      const body = JSON.parse(fetchMock.mock.calls[1][1].body)
      const prompt = body.messages[1].content
      expect(prompt).toContain('What are your day-to-day activities?')
      expect(prompt).toContain(
        'Clip to judge: "So basically at 9:30 we have a scrum call'
      )
      accept.stop()
    })

    it('sends the held question when the next clip repeats one', async () => {
      const { accept } = smartFilter(groqReplies('YES', 'YES'))
      const pod = 'Can you explain what a Kubernetes pod is and why we use it?'
      expect(await accept([pod], done)).toBe(pod)
      expect(await accept(['How is it scheduled?'], midTurn)).toBeNull()
      expect(await accept([pod], done)).toBe('How is it scheduled?')
      accept.stop()
    })

    it('sends the held question as soon as you start speaking', async () => {
      vi.useFakeTimers()
      try {
        const { accept, late } = smartFilter(groqReply('YES'))
        await accept(['How do you scale it?'], midTurn)
        expect(accept.heldSince()).not.toBeNull()
        accept.flush()
        await vi.advanceTimersByTimeAsync(0)
        expect(late).toHaveBeenCalledWith(
          expect.objectContaining({
            text: 'How do you scale it?',
            sent: true,
            check: expect.objectContaining({
              note: 'Sent when you started speaking',
            }),
          })
        )
        expect(accept.holding()).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
