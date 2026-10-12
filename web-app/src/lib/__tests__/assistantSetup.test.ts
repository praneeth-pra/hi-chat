import { describe, expect, it, vi } from 'vitest'
import {
  assistantName,
  buildInstructions,
  extractProfile,
  parseProfile,
} from '../assistantSetup'
import { withMediumLength, MEDIUM_LENGTH_RULE } from '../answerDetail'

const profile = {
  candidate: 'Priya Sharma',
  role: 'Data Analyst',
  company: 'Acme',
  summary: 'Data analyst, 4 years in SQL and Power BI',
  focus: ['SQL', 'Power BI'],
}

describe('assistant quick setup', () => {
  it('parses the model JSON and trims bad values', () => {
    const parsed = parseProfile(
      'here: {"candidate":" Priya  Sharma ","role":"Data Analyst","focus":["SQL",3,""]}'
    )
    expect(parsed).toEqual({
      candidate: 'Priya Sharma',
      role: 'Data Analyst',
      company: '',
      summary: '',
      focus: ['SQL'],
    })
  })

  it('names the assistant after the candidate and role', () => {
    expect(assistantName(profile)).toBe('Priya · Data Analyst')
    expect(assistantName({ ...profile, candidate: '' })).toBe('Data Analyst')
  })

  it('writes first-person instructions that forbid invented experience', () => {
    const text = buildInstructions(profile, true)
    expect(text).toContain(
      'You are Priya Sharma, interviewing for the Data Analyst role at Acme'
    )
    expect(text).toContain('Never invent experience')
    expect(text).toContain('job description is also in your documents')
    expect(text).toContain('SQL, Power BI')
    expect(buildInstructions(profile, false)).not.toContain('job description')
  })

  it('falls back to the next provider when the first fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(profile) } }],
          })
        )
      )
    const result = await extractProfile(
      'resume',
      '',
      [
        {
          apiKey: 'g',
          baseUrl: 'https://api.groq.com/openai/v1',
          model: 'openai/gpt-oss-120b',
        },
        {
          apiKey: 'c',
          baseUrl: 'https://api.cerebras.ai/v1',
          model: 'gpt-oss-120b',
        },
      ],
      fetchImpl as unknown as typeof fetch
    )
    expect(result.role).toBe('Data Analyst')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('needs an API key', async () => {
    await expect(
      extractProfile('r', '', [{ model: 'x', baseUrl: 'https://x' }])
    ).rejects.toThrow('API key')
  })
})

describe('withMediumLength', () => {
  const messages = [
    { role: 'system', content: 'Be helpful.' },
    { role: 'user', content: 'Tell me about yourself' },
  ]
  it('adds the length target for gpt-oss-20b only', () => {
    expect(withMediumLength(messages, 'openai/gpt-oss-120b')).toBe(messages)
    const out = withMediumLength(messages, 'openai/gpt-oss-20b')
    expect(out[0].content).toBe(`Be helpful.\n\n${MEDIUM_LENGTH_RULE}`)
    expect(out[1]).toBe(messages[1])
    expect(messages[0].content).toBe('Be helpful.')
  })
  it('adds a system message when there is none', () => {
    const out = withMediumLength([messages[1]], 'openai/gpt-oss-20b')
    expect(out[0]).toEqual({ role: 'system', content: MEDIUM_LENGTH_RULE })
  })
})

describe('setupAssistant', () => {
  const reply = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }))

  it('builds the whole assistant and keeps id, emoji and settings when editing', async () => {
    const { setupAssistant } = await import('../assistantSetup')
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      return body.model === 'openai/gpt-oss-120b'
        ? reply(JSON.stringify(profile))
        : reply('SQL\nPower BI')
    })
    const base = {
      id: 'abc',
      avatar: '🦊',
      created_at: 1,
      name: 'Old',
      instructions: 'old',
      parameters: { temperature: 0.2 },
    }
    const out = await setupAssistant(
      { name: 'resume.pdf', text: 'Priya resume' },
      { name: 'jd.pdf', text: 'Data Analyst at Acme' },
      { groq: { apiKey: 'g' } },
      base,
      fetchImpl as unknown as typeof fetch
    )
    expect(out).toMatchObject({
      id: 'abc',
      avatar: '🦊',
      created_at: 1,
      name: 'Priya · Data Analyst',
      description: profile.summary,
      parameters: { temperature: 0.2 },
      keyterms: ['SQL', 'Power BI'],
    })
    expect(out.documents?.map((d) => d.name)).toEqual(['resume.pdf', 'jd.pdf'])
    expect(out.instructions).toContain('Never invent experience')
  })

  it('still sets up when key terms fail, and skips an empty JD', async () => {
    const { setupAssistant } = await import('../assistantSetup')
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      return body.response_format
        ? reply(JSON.stringify(profile))
        : new Response('down', { status: 503 })
    })
    const out = await setupAssistant(
      { name: 'resume.pdf', text: 'Priya resume' },
      { name: 'jd.txt', text: '   ' },
      { groq: { apiKey: 'g' } },
      undefined,
      fetchImpl as unknown as typeof fetch
    )
    expect(out.keyterms).toBeUndefined()
    expect(out.documents).toHaveLength(1)
    expect(out.avatar).toBe('🧑‍💼')
  })
})
