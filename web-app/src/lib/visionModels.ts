import { ChatCompletionMessageParam } from 'token.js'

// Most Groq and Cerebras models can't read images. A question with an image
// attached goes to that provider's vision model; earlier images are not
// resent, so follow-ups stay on the chat's chosen (faster) model and see the
// vision model's answer instead.
export const VISION_MODELS: Record<string, { model: string; maxImages: number }> =
  {
    groq: { model: 'qwen/qwen3.8-27b', maxImages: 3 },
    // Cerebras allows 2 images per request on the free tier (10 on paid plans)
    cerebras: { model: 'qwen-3.8-27b', maxImages: 2 },
  }

// The Groq chat models offered in the picker; image questions go to the
// vision model above on their own
export const GROQ_CHAT_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b']

export const GROQ_VISION_MODEL = VISION_MODELS.groq.model
export const CEREBRAS_VISION_MODEL = VISION_MODELS.cerebras.model

// Providers whose image questions are routed to a vision model
export const routesImages = (provider: string) => provider in VISION_MODELS

// The vision model is picked on its own, so the model picker hides it
export const isAutoVisionModel = (provider: string, modelId: string) =>
  VISION_MODELS[provider]?.model === modelId

type Part = { type?: string }

const OMITTED = { type: 'text', text: '[earlier image omitted]' }

const isImagePart = (part: unknown) =>
  (part as Part | null)?.type === 'image_url'

export const hasImages = (messages: ChatCompletionMessageParam[]) =>
  messages.some((m) => Array.isArray(m.content) && m.content.some(isImagePart))

export const pickVisionModel = (
  provider: string,
  modelId: string,
  messages: ChatCompletionMessageParam[]
) =>
  routesImages(provider) && hasImages(messages)
    ? VISION_MODELS[provider].model
    : modelId

// Keeps the most recent images and replaces older ones with a short note
export const limitImages = (
  messages: ChatCompletionMessageParam[],
  max: number
): ChatCompletionMessageParam[] => {
  let remaining = max
  return [...messages]
    .reverse()
    .map((m) => {
      if (!Array.isArray(m.content)) return m
      const content = [...m.content]
        .reverse()
        .map((part) => {
          if (!isImagePart(part)) return part
          if (remaining > 0) {
            remaining--
            return part
          }
          return OMITTED
        })
        .reverse()
      return { ...m, content } as ChatCompletionMessageParam
    })
    .reverse()
}

// Keeps images only on the latest user message
export const dropOlderImages = (
  messages: ChatCompletionMessageParam[]
): ChatCompletionMessageParam[] => {
  let lastUser = -1
  messages.forEach((m, i) => {
    if (m.role === 'user') lastUser = i
  })
  return messages.map((m, i) =>
    i === lastUser || !Array.isArray(m.content) || !m.content.some(isImagePart)
      ? m
      : ({
          ...m,
          content: m.content.map((part) => (isImagePart(part) ? OMITTED : part)),
        } as ChatCompletionMessageParam)
  )
}

// Everything an image request needs: older images dropped, at most the
// provider's image limit left, and its vision model when an image remains
export const prepareVisionRequest = (
  provider: string,
  modelId: string,
  messages: ChatCompletionMessageParam[]
) => {
  const prepared = limitImages(
    dropOlderImages(messages),
    VISION_MODELS[provider]?.maxImages ?? Infinity
  )
  return {
    model: pickVisionModel(provider, modelId, prepared),
    messages: prepared,
  }
}
