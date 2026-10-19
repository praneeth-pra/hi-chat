import { create } from 'zustand'
import { createImageAttachment, type Attachment } from '@/types/attachment'

/**
 * Screenshots the Mac or Windows app took with its screenshot key, waiting
 * for the message box to send each on its own, with no words.
 */
export const useScreenshotDelivery = create<{ pending: Attachment[] }>(() => ({
  pending: [],
}))

const DATA_URL = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/

/** Queues a screenshot (a JPEG or PNG data URL) to send. */
export function deliverScreenshot(dataUrl: string, now = new Date()): boolean {
  const match = DATA_URL.exec(dataUrl)
  if (!match) return false
  const [, mimeType, base64] = match
  const stamp = now.toTimeString().slice(0, 8).replace(/:/g, '.')
  const image = createImageAttachment({
    name: `Screenshot ${stamp}.${mimeType === 'image/png' ? 'png' : 'jpg'}`,
    size: Math.floor((base64.length * 3) / 4),
    mimeType,
    base64,
    dataUrl,
  })
  useScreenshotDelivery.setState((s) => ({ pending: [...s.pending, image] }))
  return true
}
