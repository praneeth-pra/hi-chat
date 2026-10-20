import { describe, expect, it } from 'vitest'
import {
  cameraSocketUrl,
  crc32,
  extensionConfig,
  zipFiles,
} from '../remoteCamera'

describe('remote camera', () => {
  it('builds the socket address with the key', () => {
    expect(
      cameraSocketUrl({ protocol: 'https:', host: 'hi.example' }, 'a b')
    ).toBe('wss://hi.example/api/camera?role=send&key=a%20b')
  })

  it('computes standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('packs files into a valid stored zip', () => {
    const zip = zipFiles({ 'a/x.txt': 'hello', 'a/y.js': 'é' })
    const view = new DataView(zip.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    // End of central directory: two entries
    const end = zip.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    const text = new TextDecoder().decode(zip)
    expect(text).toContain('a/x.txthello')
  })

  it('writes the extension config as a script', () => {
    const config = extensionConfig('https://hi.example', 'k1')
    expect(config).toContain(
      'self.HICHAT_CAMERA = {"site":"https://hi.example","key":"k1"}'
    )
  })
})
