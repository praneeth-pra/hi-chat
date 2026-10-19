import { describe, it, expect } from 'vitest'
import { ContentType, ThreadMessage } from '@janhq/core'
import { contextSize, formatBytes, formatTokens } from '../contextSize'

const text = (role: 'user' | 'assistant', value: string) =>
  ({
    id: `${role}-${value.length}`,
    role,
    content: [{ type: ContentType.Text, text: { value, annotations: [] } }],
  }) as unknown as ThreadMessage

const image = (bytes: number) =>
  ({
    id: `img-${bytes}`,
    role: 'user',
    content: [
      {
        type: ContentType.Text,
        text: { value: 'solve this', annotations: [] },
      },
      {
        type: ContentType.Image,
        image_url: {
          url: `data:image/png;base64,${'A'.repeat((bytes * 4) / 3)}`,
        },
      },
    ],
  }) as unknown as ThreadMessage

describe('contextSize', () => {
  it('counts the instructions, the recent messages and the draft', () => {
    const size = contextSize(
      [text('user', 'a'.repeat(400)), text('assistant', 'b'.repeat(400))],
      's'.repeat(800),
      'd'.repeat(400)
    )
    expect(size).toMatchObject({
      tokens: 500,
      baseTokens: 200,
      images: 0,
      level: 'light',
    })
  })

  it('counts each image still in the recent messages, which is sent again', () => {
    const imgs = (n: number) => Array.from({ length: n }, () => image(600_000))
    const size = contextSize(imgs(2))
    expect(size.images).toBe(2)
    expect(size.imageBytes).toBe(1_200_000)
    expect(size.level).toBe('light')
    expect(contextSize(imgs(3)).level).toBe('medium')
    expect(contextSize(imgs(5)).level).toBe('heavy')
  })

  it('leaves out messages older than the ones sent', () => {
    const old = Array.from({ length: 40 }, (_, i) =>
      i === 0 ? image(3_000_000) : text(i % 2 ? 'assistant' : 'user', 'x')
    )
    expect(contextSize(old).images).toBe(0)
  })

  it('does not count the instructions and documents towards the level', () => {
    const resume = 'r'.repeat(80_000)
    expect(contextSize([text('user', 'hi')], resume).level).toBe('light')
    expect(contextSize([text('user', 'x'.repeat(60_000))]).level).toBe('medium')
  })

  it('formats tokens and bytes', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(3240)).toBe('3.2k')
    expect(formatTokens(18_400)).toBe('18k')
    expect(formatBytes(1_400_000)).toBe('1.3 MB')
    expect(formatBytes(300_000)).toBe('293 KB')
  })
})
