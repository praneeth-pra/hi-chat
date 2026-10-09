import { describe, it, expect } from 'vitest'
import {
  CEREBRAS_VISION_MODEL,
  GROQ_VISION_MODEL,
  hasImages,
  isAutoVisionModel,
  limitImages,
  pickVisionModel,
  prepareVisionRequest,
} from '../visionModels'

const image = (n: number) => ({
  type: 'image_url',
  image_url: { url: `data:image/png;base64,${n}` },
})
const withImages = (...ns: number[]) => ({
  role: 'user',
  content: [{ type: 'text', text: 'look' }, ...ns.map(image)],
})

describe('visionModels', () => {
  it('detects images in messages', () => {
    expect(hasImages([{ role: 'user', content: 'hi' }] as any)).toBe(false)
    expect(hasImages([withImages(1)] as any)).toBe(true)
  })

  it('sends image requests to the provider vision model only', () => {
    const text = [{ role: 'user', content: 'hi' }] as any
    const img = [withImages(1)] as any
    expect(pickVisionModel('groq', 'llama-3.3-70b-versatile', text)).toBe(
      'llama-3.3-70b-versatile'
    )
    expect(pickVisionModel('groq', 'llama-3.3-70b-versatile', img)).toBe(
      GROQ_VISION_MODEL
    )
    expect(pickVisionModel('cerebras', 'gpt-oss-120b', img)).toBe(
      CEREBRAS_VISION_MODEL
    )
    expect(pickVisionModel('openai', 'gpt-4o', img)).toBe('gpt-4o')
  })

  it('keeps only the most recent images', () => {
    const out = limitImages([withImages(1, 2), withImages(3, 4)] as any, 3)
    const urls = out.flatMap((m: any) =>
      m.content.map((p: any) => p.image_url?.url ?? p.text)
    )
    expect(urls).toEqual([
      'look',
      '[earlier image omitted]',
      'data:image/png;base64,2',
      'look',
      'data:image/png;base64,3',
      'data:image/png;base64,4',
    ])
  })

  it('uses each provider image limit', () => {
    const out = prepareVisionRequest('cerebras', 'gpt-oss-120b', [
      withImages(1, 2, 3),
    ] as any)
    expect(JSON.stringify(out.messages).match(/base64/g)).toHaveLength(2)
  })

  it('sends an image only with its own question', () => {
    const first = prepareVisionRequest('groq', 'llama-3.3-70b-versatile', [
      withImages(1),
    ] as any)
    expect(first.model).toBe(GROQ_VISION_MODEL)

    const followUp = prepareVisionRequest('groq', 'llama-3.3-70b-versatile', [
      withImages(1),
      { role: 'assistant', content: 'It is red.' },
      { role: 'user', content: 'why?' },
    ] as any)
    expect(followUp.model).toBe('llama-3.3-70b-versatile')
    expect(hasImages(followUp.messages)).toBe(false)
    expect((followUp.messages[0] as any).content[1].text).toBe(
      '[earlier image omitted]'
    )
  })
})

describe('isAutoVisionModel', () => {
  it('flags only the vision model a provider routes images to', () => {
    expect(isAutoVisionModel('groq', 'qwen/qwen3.8-27b')).toBe(true)
    expect(isAutoVisionModel('groq', 'openai/gpt-oss-20b')).toBe(false)
    expect(isAutoVisionModel('openai', 'qwen/qwen3.8-27b')).toBe(false)
  })
})
