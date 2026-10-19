import { ContentType, ThreadMessage } from '@janhq/core'
import { recentMessages } from '@/lib/messages'

/**
 * Roughly how much each question sends: the assistant's instructions and
 * documents, the recent messages (see recentMessages) and every image still
 * among them, which goes again, whole, with each question. Whether that
 * slows answers down is measured, not guessed: see replySpeed.
 */
export type ContextSize = {
  /** Text tokens, estimated at 4 characters a token. */
  tokens: number
  /** Of those, the assistant's instructions and documents: the same in a new chat. */
  baseTokens: number
  images: number
  imageBytes: number
}

const CHARS_PER_TOKEN = 4

/** Bytes in a data URL's base64 body (or the URL's length otherwise). */
const urlBytes = (url: string) => {
  const comma = url.indexOf(',')
  return comma === -1
    ? url.length
    : Math.round(((url.length - comma - 1) * 3) / 4)
}

export function contextSize(
  messages: ThreadMessage[],
  system = '',
  draft = '',
  draftImages: string[] = []
): ContextSize {
  let chars = draft.length
  const imageUrls = [...draftImages]
  for (const m of recentMessages(messages.filter((e) => !e.metadata?.error))) {
    for (const part of m.content ?? []) {
      if (part.type === ContentType.Image && part.image_url?.url)
        imageUrls.push(part.image_url.url)
      else chars += part.text?.value?.length ?? 0
    }
  }
  const chatTokens = Math.round(chars / CHARS_PER_TOKEN)
  const baseTokens = Math.round(system.length / CHARS_PER_TOKEN)
  const tokens = chatTokens + baseTokens
  const imageBytes = imageUrls.reduce((sum, url) => sum + urlBytes(url), 0)
  const images = imageUrls.length
  return { tokens, baseTokens, images, imageBytes }
}

/** "3.2k" for tokens, "1.4 MB" / "300 KB" for bytes. */
export const formatTokens = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`
export const formatBytes = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`
