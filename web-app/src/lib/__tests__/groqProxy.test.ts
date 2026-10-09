import { describe, it, expect } from 'vitest'
import { viaGroqProxy } from '../groqProxy'

describe('viaGroqProxy', () => {
  it('sends Groq requests through this site in the web app', () => {
    expect(viaGroqProxy('https://api.groq.com/openai/v1', true)).toBe(
      `${window.location.origin}/api/groq/openai/v1`
    )
  })

  it('leaves other providers and the desktop app alone', () => {
    expect(viaGroqProxy('https://api.cerebras.ai/v1', true)).toBe(
      'https://api.cerebras.ai/v1'
    )
    expect(viaGroqProxy('https://api.groq.com/openai/v1', false)).toBe(
      'https://api.groq.com/openai/v1'
    )
    expect(viaGroqProxy(undefined, true)).toBeUndefined()
  })
})
