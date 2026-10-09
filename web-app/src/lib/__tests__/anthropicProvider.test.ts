import { describe, expect, it } from 'vitest'
import { anthropicConfig } from '../anthropicProvider'

const p = (provider: string, api_key?: string, base_url?: string) =>
  ({ provider, api_key, base_url, active: true, models: [] }) as ModelProvider

describe('anthropicConfig', () => {
  it('uses a provider added by hand with an Anthropic base URL', () => {
    expect(
      anthropicConfig([
        p('groq', 'g'),
        p('Claude', 'sk-ant-1', 'https://api.anthropic.com'),
      ])
    ).toEqual({ apiKey: 'sk-ant-1', baseUrl: 'https://api.anthropic.com' })
  })

  it('matches by name when the base URL is something else', () => {
    expect(
      anthropicConfig([p('Claude', 'k', 'https://example.com/v1')])
    ).toEqual({ apiKey: 'k', baseUrl: 'https://api.anthropic.com' })
  })

  it('prefers the built-in anthropic provider and skips ones without a key', () => {
    expect(
      anthropicConfig([
        p('Claude', '', 'https://api.anthropic.com'),
        p('anthropic', 'k2', 'https://api.anthropic.com/v1'),
      ])
    ).toEqual({ apiKey: 'k2', baseUrl: 'https://api.anthropic.com/v1' })
    expect(anthropicConfig([p('groq', 'g')])).toEqual({})
  })
})
