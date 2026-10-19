import { describe, it, expect, beforeEach, vi } from 'vitest'
import { create } from 'zustand'

const { useDictation } = vi.hoisted(() => ({
  useDictation: {} as ReturnType<typeof create<{ status: string }>>,
}))
vi.mock('@/lib/dictation', async () => {
  const { create } = await import('zustand')
  Object.assign(
    useDictation,
    create(() => ({ status: 'idle' }))
  )
  return { useDictation }
})

import {
  deliverScreenshot,
  takeHeldScreenshots,
  useScreenshotDelivery,
} from '../screenshotDelivery'
import { useDictationDelivery } from '../dictationDelivery'

describe('screenshot delivery', () => {
  beforeEach(() => {
    useScreenshotDelivery.setState({ pending: [], held: [] })
    useDictationDelivery.setState({ pending: [] })
    useDictation.setState({ status: 'idle' })
  })

  it('queues a JPEG from the app as an image attachment', () => {
    const at = new Date(2026, 9, 19, 20, 5, 9)
    expect(deliverScreenshot('data:image/jpeg;base64,QUJD', at)).toBe(true)
    expect(useScreenshotDelivery.getState().pending).toEqual([
      {
        type: 'image',
        name: 'Screenshot 20.05.09.jpg',
        size: 3,
        mimeType: 'image/jpeg',
        base64: 'QUJD',
        dataUrl: 'data:image/jpeg;base64,QUJD',
      },
    ])
  })

  it('takes nothing but a JPEG or PNG data URL', () => {
    for (const bad of [
      '',
      'QUJD',
      'data:text/html;base64,QUJD',
      'https://x/y.png',
    ])
      expect(deliverScreenshot(bad)).toBe(false)
    expect(useScreenshotDelivery.getState().pending).toEqual([])
  })

  it('keeps a screenshot taken while dictating for the dictated message', () => {
    useDictation.setState({ status: 'recording' })
    deliverScreenshot('data:image/png;base64,QUJD')
    expect(useScreenshotDelivery.getState().pending).toEqual([])
    // The words arrive, then dictation goes idle: the message takes it
    useDictationDelivery.setState({ pending: ['look at this'] })
    useDictation.setState({ status: 'idle' })
    expect(useScreenshotDelivery.getState().pending).toEqual([])
    expect(takeHeldScreenshots()?.map((a) => a.mimeType)).toEqual(['image/png'])
    expect(takeHeldScreenshots()).toBeUndefined()
  })

  it('sends it on its own when the dictation ends with no words', () => {
    useDictation.setState({ status: 'recording' })
    deliverScreenshot('data:image/png;base64,QUJD')
    useDictation.setState({ status: 'idle' })
    expect(useScreenshotDelivery.getState().held).toEqual([])
    expect(useScreenshotDelivery.getState().pending).toHaveLength(1)
  })
})
