import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('mirror link', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('keeps one secret per app until renewed', async () => {
    const m = await import('../mirrorLink')
    const first = m.mirrorLinkSecret()
    expect(first).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(m.mirrorLinkSecret()).toBe(first)
    // Another load of the app reads the same one
    vi.resetModules()
    const again = await import('../mirrorLink')
    expect(again.mirrorLinkSecret()).toBe(first)

    const heard: string[] = []
    const off = again.onMirrorLinkRenewed((old) => heard.push(old))
    const next = again.renewMirrorLink()
    off()
    expect(next).not.toBe(first)
    expect(heard).toEqual([first])
    expect(again.mirrorLinkSecret()).toBe(next)
  })

  it('builds and reads link addresses', async () => {
    const m = await import('../mirrorLink')
    const secret = 'A'.repeat(24)
    expect(m.mirrorLinkUrl({ origin: 'https://hi.example' }, secret)).toBe(
      `https://hi.example/m/${secret}`
    )
    expect(m.linkFromPath(`/m/${secret}`)).toBe(secret)
    expect(m.linkFromPath('/m/short')).toBeNull()
    expect(m.linkFromPath('/mirror')).toBeNull()
  })
})
