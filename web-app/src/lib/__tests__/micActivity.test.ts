import { describe, expect, it } from 'vitest'
import { findMicDevice, getDictationMic, setDictationMic } from '../micActivity'

const device = (deviceId: string, label: string, kind = 'audioinput') =>
  ({ deviceId, label, kind }) as MediaDeviceInfo

describe('findMicDevice', () => {
  it('picks the default input and never the loopback', () => {
    const devices = [
      device('bh', 'BlackHole 2ch'),
      device('out', 'Speakers', 'audiooutput'),
      device('mac', 'MacBook Pro Microphone'),
      device('default', 'Default - MacBook Pro Microphone'),
    ]
    expect(findMicDevice(devices)?.deviceId).toBe('default')
    expect(findMicDevice(devices.slice(0, 3))?.deviceId).toBe('mac')
    expect(findMicDevice(devices.slice(0, 2))).toBeUndefined()
  })

  it('uses the mic picked in Settings when it is plugged in', () => {
    const devices = [
      device('bh', 'BlackHole 2ch'),
      device('cam', 'Logitech Webcam C920'),
      device('default', 'Default - MacBook Pro Microphone'),
    ]
    expect(findMicDevice(devices, 'Logitech Webcam C920')?.deviceId).toBe('cam')
    expect(findMicDevice(devices, 'Unplugged USB mic')?.deviceId).toBe(
      'default'
    )
    expect(findMicDevice(devices, 'BlackHole 2ch')?.deviceId).toBe('default')
  })
})

describe('microphone settings', () => {
  it('retains the legacy microphone choice until dictation is explicitly configured', () => {
    localStorage.clear()
    localStorage.setItem('speaker-mic-device', 'USB Mic')
    expect(getDictationMic()).toBe('USB Mic')
    setDictationMic('MacBook Mic')
    expect(getDictationMic()).toBe('MacBook Mic')
    localStorage.setItem('speaker-mic-device', 'Other Mic')
    expect(getDictationMic()).toBe('MacBook Mic')
    setDictationMic('')
    expect(getDictationMic()).toBe('')
    localStorage.clear()
  })
})
