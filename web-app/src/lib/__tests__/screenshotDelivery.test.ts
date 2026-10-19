import { describe, it, expect, beforeEach } from 'vitest'
import { deliverScreenshot, useScreenshotDelivery } from '../screenshotDelivery'

describe('screenshot delivery', () => {
  beforeEach(() => useScreenshotDelivery.setState({ pending: [] }))

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
})
