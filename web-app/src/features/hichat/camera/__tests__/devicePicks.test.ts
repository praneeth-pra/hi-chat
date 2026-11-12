import { describe, expect, it } from 'vitest'
import { devicePicks } from '../RemoteCameraPanel'

const dev = (deviceId: string, label: string, kind = 'audioinput') =>
  ({ deviceId, label, kind, groupId: 'g' }) as MediaDeviceInfo

describe('devicePicks', () => {
  it('lists each microphone once and names what Default is', () => {
    const { list, defaultName } = devicePicks([
      dev('default', 'Default - MacBook Air Microphone (Built-in)'),
      dev('a1', 'MacBook Air Microphone (Built-in)'),
      dev('b2', 'AirPods Pro'),
    ])
    expect(list.map((d) => d.deviceId)).toEqual(['a1', 'b2'])
    expect(defaultName).toBe('MacBook Air Microphone (Built-in)')
  })

  it('drops the Windows Communications entry too', () => {
    const { list } = devicePicks([
      dev('default', 'Default - Microphone Array (Realtek)'),
      dev('communications', 'Communications - Microphone Array (Realtek)'),
      dev('m1', 'Microphone Array (Realtek)'),
    ])
    expect(list.map((d) => d.deviceId)).toEqual(['m1'])
  })

  it('has no name for Default before labels are allowed', () => {
    const { list, defaultName } = devicePicks([dev('', ''), dev('default', '')])
    expect(defaultName).toBeUndefined()
    expect(list).toHaveLength(1)
  })
})
