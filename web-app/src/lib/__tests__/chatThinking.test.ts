import { beforeEach, describe, expect, it } from 'vitest'
import {
  CHAT_THINKING_STORAGE_KEY,
  chatCacheParams,
  chatThinkingParams,
  getChatThinking,
  setChatThinking,
} from '../chatThinking'

describe('chat thinking', () => {
  beforeEach(() => localStorage.removeItem(CHAT_THINKING_STORAGE_KEY))

  it('defaults to low', () => {
    expect(getChatThinking()).toBe('low')
    expect(chatThinkingParams('groq', 'openai/gpt-oss-20b')).toEqual({
      reasoning_effort: 'low',
    })
  })

  it('keeps the chosen level', () => {
    setChatThinking('medium')
    expect(getChatThinking()).toBe('medium')
    expect(chatThinkingParams('cerebras', 'gpt-oss-120b')).toEqual({
      reasoning_effort: 'medium',
    })
  })

  it('ignores an unknown saved value', () => {
    localStorage.setItem(CHAT_THINKING_STORAGE_KEY, 'high')
    expect(getChatThinking()).toBe('low')
  })

  it('leaves other models and providers alone', () => {
    expect(
      chatThinkingParams('groq', 'meta-llama/llama-4-scout-17b-16e-instruct')
    ).toEqual({})
    expect(chatThinkingParams('openai', 'gpt-oss-20b')).toEqual({})
  })

  it('sends Cerebras a cache key per thread, and Groq none', () => {
    expect(chatCacheParams('cerebras', 'thread-1')).toEqual({
      prompt_cache_key: 'thread-1',
    })
    expect(chatCacheParams('groq', 'thread-1')).toEqual({})
    expect(chatCacheParams('cerebras', undefined)).toEqual({})
  })
})
