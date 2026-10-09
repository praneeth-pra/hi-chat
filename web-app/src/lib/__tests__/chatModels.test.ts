import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHAT_FALLBACK_STORAGE_KEY,
  CHAT_MODEL_STORAGE_KEY,
  chatModelOrder,
  autoChain,
  getChatFallback,
  getChatModel,
  setChatFallback,
  setChatModel,
  streamWithFallback,
  useChatAuto,
} from '../chatModels'

async function* chunks(...values: string[]) {
  for (const v of values) yield v
}

const collect = async (stream: AsyncIterable<string>) => {
  const out: string[] = []
  for await (const v of stream) out.push(v)
  return out
}

describe('chat model order', () => {
  beforeEach(() => {
    localStorage.removeItem(CHAT_MODEL_STORAGE_KEY)
    localStorage.removeItem(CHAT_FALLBACK_STORAGE_KEY)
  })

  it('defaults to Claude Haiku, then Cerebras 120b, then the Groq models', () => {
    expect(getChatModel()).toBe('claude-haiku')
    expect(getChatFallback()).toBe('cerebras-120b')
    expect(chatModelOrder()).toEqual([
      'claude-haiku',
      'cerebras-120b',
      'groq-120b',
      'groq-20b',
    ])
  })

  it('keeps the chosen model and fallback', () => {
    setChatModel('groq-120b')
    setChatFallback('cerebras-120b')
    expect(chatModelOrder()).toEqual([
      'groq-120b',
      'cerebras-120b',
      'claude-haiku',
      'groq-20b',
    ])
  })

  it('never uses the chat model as its own fallback', () => {
    setChatFallback('groq-20b')
    setChatModel('groq-20b')
    expect(getChatFallback()).toBe('cerebras-120b')
  })

  it('auto tries the models in the settings order', () => {
    setChatModel('groq-120b')
    setChatFallback('cerebras-120b')
    expect(autoChain()).toEqual([
      { provider: 'groq', model: 'openai/gpt-oss-120b', firstChunkMs: 1500 },
      { provider: 'cerebras', model: 'gpt-oss-120b', firstChunkMs: 1500 },
      { provider: 'anthropic', model: 'claude-haiku-4-5', firstChunkMs: 1500 },
      { provider: 'groq', model: 'openai/gpt-oss-20b', firstChunkMs: 1500 },
    ])
  })

  it('tries one Claude model, and waits longer for Sonnet', () => {
    setChatModel('claude-sonnet')
    expect(chatModelOrder()).toEqual([
      'claude-sonnet',
      'cerebras-120b',
      'groq-120b',
      'groq-20b',
    ])
    expect(autoChain()[0]).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      firstChunkMs: 2500,
    })
  })

  it('auto is on by default', () => {
    expect(useChatAuto.getState().auto).toBe(true)
  })
})

describe('streamWithFallback', () => {
  it('streams the first model when it answers', async () => {
    const skipped = vi.fn()
    const second = vi.fn()
    const stream = await streamWithFallback(
      [async () => chunks('a', 'b'), second],
      new AbortController().signal,
      skipped
    )
    expect(await collect(stream)).toEqual(['a', 'b'])
    expect(second).not.toHaveBeenCalled()
    expect(skipped).not.toHaveBeenCalled()
  })

  it('moves on when a model fails', async () => {
    const skipped = vi.fn()
    const stream = await streamWithFallback(
      [
        async () => {
          throw new Error('503')
        },
        async () => chunks('ok'),
      ],
      new AbortController().signal,
      skipped
    )
    expect(await collect(stream)).toEqual(['ok'])
    expect(skipped).toHaveBeenCalledWith(0, '503')
  })

  it('moves on and aborts a model that stays silent', async () => {
    const skipped = vi.fn()
    let silentAborted = false
    const stream = await streamWithFallback(
      [
        async (controller) => {
          controller.signal.addEventListener('abort', () => {
            silentAborted = true
          })
          return (async function* () {
            await new Promise(() => {})
            yield 'never'
          })()
        },
        async () => chunks('fallback'),
      ],
      new AbortController().signal,
      skipped,
      20
    )
    expect(await collect(stream)).toEqual(['fallback'])
    expect(silentAborted).toBe(true)
    expect(skipped).toHaveBeenCalledWith(0, 'no reply in 0.02 s')
  })

  it('gives the last model as long as it needs and passes its error on', async () => {
    await expect(
      streamWithFallback(
        [
          async () => {
            throw new Error('first')
          },
          async () => {
            throw new Error('last')
          },
        ],
        new AbortController().signal,
        () => {},
        20
      )
    ).rejects.toThrow('last')
  })

  it('stops when the user stops the reply', async () => {
    const outer = new AbortController()
    const second = vi.fn()
    const pending = streamWithFallback(
      [
        async (controller) => {
          await new Promise((_, reject) =>
            controller.signal.addEventListener('abort', () =>
              reject(new Error('aborted'))
            )
          )
          return chunks()
        },
        second,
      ],
      outer.signal,
      () => {},
      1000
    )
    outer.abort()
    await expect(pending).rejects.toThrow('aborted')
    expect(second).not.toHaveBeenCalled()
  })
})

describe('streamWithFallback with a head start', () => {
  const silent =
    (onAbort: () => void) => async (controller: AbortController) => {
      controller.signal.addEventListener('abort', onAbort)
      return (async function* () {
        await new Promise(() => {})
        yield 'never'
      })()
    }

  it('starts the fallback at once and stops it when the first answers', async () => {
    let fallbackAborted = false
    const fallback = vi.fn(silent(() => (fallbackAborted = true)))
    const stream = await streamWithFallback(
      [async () => chunks('claude'), fallback],
      new AbortController().signal,
      () => {},
      1000,
      { headStart: true }
    )
    expect(await collect(stream)).toEqual(['claude'])
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(fallbackAborted).toBe(true)
  })

  it('uses the fallback already under way when the first is slow', async () => {
    let firstAborted = false
    const fallback = vi.fn(async () => chunks('cerebras'))
    const skipped = vi.fn()
    const stream = await streamWithFallback(
      [silent(() => (firstAborted = true)), fallback],
      new AbortController().signal,
      skipped,
      20,
      { headStart: true }
    )
    expect(await collect(stream)).toEqual(['cerebras'])
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(firstAborted).toBe(true)
    expect(skipped).toHaveBeenCalledWith(0, 'no reply in 0.02 s')
  })

  it('waits each model its own time', async () => {
    const skipped = vi.fn()
    const slowStart = async () =>
      (async function* () {
        await new Promise((r) => setTimeout(r, 30))
        yield 'sonnet'
      })()
    const stream = await streamWithFallback(
      [slowStart, async () => chunks('cerebras')],
      new AbortController().signal,
      skipped,
      [80, 20],
      { headStart: true }
    )
    expect(await collect(stream)).toEqual(['sonnet'])
    expect(skipped).not.toHaveBeenCalled()
  })
})

describe('moving to Claude by default', () => {
  it('moves a browser on the old default to Claude once, then keeps choices', () => {
    localStorage.removeItem('chat-model-claude-default')
    localStorage.setItem(CHAT_MODEL_STORAGE_KEY, 'cerebras-120b')
    expect(getChatModel()).toBe('claude-haiku')
    setChatModel('cerebras-120b')
    expect(getChatModel()).toBe('cerebras-120b')
  })

  it('keeps a model chosen other than the old default', () => {
    localStorage.removeItem('chat-model-claude-default')
    localStorage.setItem(CHAT_MODEL_STORAGE_KEY, 'groq-120b')
    expect(getChatModel()).toBe('groq-120b')
  })
})
