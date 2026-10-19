import { create } from 'zustand'
import { createImageAttachment, type Attachment } from '@/types/attachment'
import { useDictation } from '@/lib/dictation'
import { useDictationDelivery } from '@/lib/dictationDelivery'

/**
 * Screenshots the Mac or Windows app took with its screenshot key. pending:
 * waiting for the message box to send each on its own, with no words. held:
 * taken while dictating, so they go out with the dictated words instead.
 */
export const useScreenshotDelivery = create<{
  pending: Attachment[]
  held: Attachment[]
}>(() => ({ pending: [], held: [] }))

const DATA_URL = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/

const dictating = () =>
  ['starting', 'recording', 'transcribing'].includes(
    useDictation.getState().status
  )

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
  if (dictating()) {
    watchDictation()
    useScreenshotDelivery.setState((s) => ({ held: [...s.held, image] }))
  } else
    useScreenshotDelivery.setState((s) => ({ pending: [...s.pending, image] }))
  return true
}

/** The screenshots taken during the dictation now being sent. */
export function takeHeldScreenshots(): Attachment[] | undefined {
  const { held } = useScreenshotDelivery.getState()
  if (!held.length) return undefined
  useScreenshotDelivery.setState({ held: [] })
  return held
}

// A dictation that ends with no words to send (heard nothing, thrown away,
// failed) still sends its screenshots, on their own.
let watching = false
function watchDictation() {
  if (watching) return
  watching = true
  useDictation.subscribe((state, prev) => {
    if (state.status !== 'idle' || prev.status === 'idle') return
    const { held } = useScreenshotDelivery.getState()
    if (!held.length || useDictationDelivery.getState().pending.length) return
    useScreenshotDelivery.setState((s) => ({
      held: [],
      pending: [...s.pending, ...held],
    }))
  })
}
