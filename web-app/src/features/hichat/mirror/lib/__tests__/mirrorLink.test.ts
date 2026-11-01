import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('mirror link', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })
  afterEach(() => vi.useRealTimers())

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

  it('runs out 90 minutes after it was shared, and a new one takes over', async () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const m = await import('../mirrorLink')
    const made = m.mirrorLinkSecret()
    // Not shared yet: sharing gives a fresh link, whose clock starts now
    vi.advanceTimersByTime(60 * 60_000)
    const heard: string[] = []
    const off = m.onMirrorLinkRenewed((old) => heard.push(old))
    const shared = m.shareMirrorLink()
    expect(shared).not.toBe(made)
    expect(heard).toEqual([made])
    expect(m.mirrorLinkBorn()).toBe(Date.now())
    expect(m.mirrorLinkExpiresAt()).toBe(Date.now() + m.LINK_TTL_MS)
    // Sharing again: the same link, same clock
    vi.advanceTimersByTime(30 * 60_000)
    expect(m.shareMirrorLink()).toBe(shared)
    vi.advanceTimersByTime(60 * 60_000 - 1)
    expect(m.mirrorLinkSecret()).toBe(shared)
    vi.advanceTimersByTime(1)
    const next = m.mirrorLinkSecret()
    expect(next).not.toBe(shared)
    off()
    // and it's saved for the next load of the app
    vi.resetModules()
    const again = await import('../mirrorLink')
    expect(again.mirrorLinkSecret()).toBe(next)
  })

  it("revoking ends the link now; another window sees it's gone", async () => {
    const m = await import('../mirrorLink')
    const shared = m.shareMirrorLink()
    vi.resetModules()
    const other = await import('../mirrorLink') // another window
    expect(other.mirrorLinkSecret()).toBe(shared)
    const heard: string[] = []
    const off = m.onMirrorLinkRenewed((old) => heard.push(old))
    const next = m.renewMirrorLink()
    off()
    expect(heard).toEqual([shared])
    expect(other.mirrorLinkSecret()).toBe(next)
    // The new one hasn't been handed out: sharing it starts it fresh
    expect(m.shareMirrorLink()).not.toBe(next)
  })

  it('an old saved link (just the secret) gets 90 minutes from now', async () => {
    vi.useFakeTimers({ now: 5_000_000 })
    const secret = 'S'.repeat(24)
    localStorage.setItem('hichat-mirror-link', secret)
    const m = await import('../mirrorLink')
    expect(m.mirrorLinkSecret()).toBe(secret)
    expect(m.shareMirrorLink()).toBe(secret)
    vi.advanceTimersByTime(m.LINK_TTL_MS)
    expect(m.mirrorLinkSecret()).not.toBe(secret)
  })
})
