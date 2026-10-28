import { describe, expect, it } from 'vitest'
import { CODE_TRIES, CODE_TTL_MS, createGate, newCode } from '../mirrorGate'

function door() {
  let time = 0
  let n = 0
  const replies: Record<string, unknown>[] = []
  const shown: (string | null)[] = []
  const gate = createGate({
    reply: (m) => replies.push(m),
    onCode: (c) => shown.push(c),
    makeCode: () => ['4821', '7305', '1946'][n++],
    now: () => time,
  })
  return {
    gate,
    replies,
    shown,
    ask: (from = 'v1') => gate.knock({ t: 'knock', from, ask: true }),
    type: (code: string, from = 'v1') => gate.knock({ t: 'knock', from, code }),
    advance: (ms: number) => (time += ms),
  }
}

describe("a mirror link's door", () => {
  it('shows a code when asked, and lets in whoever types it', () => {
    const d = door()
    d.ask()
    expect(d.shown).toEqual(['4821'])
    d.type('4821')
    expect(d.replies).toEqual([{ t: 'admit', to: 'v1' }])
    expect(d.shown.at(-1)).toBe(null) // hidden again
  })

  it('a code typed before asking lets nobody in', () => {
    const d = door()
    d.type('4821')
    expect(d.replies).toEqual([{ t: 'gate', to: 'v1', left: 0 }])
  })

  it('asking again while the code is good shows the same code', () => {
    const d = door()
    d.ask()
    d.advance(CODE_TTL_MS - 1)
    d.ask()
    expect(d.shown).toEqual(['4821', '4821'])
  })

  it('a code lasts 5 minutes; then a new one can be asked for', () => {
    const d = door()
    expect(CODE_TTL_MS).toBe(5 * 60_000)
    d.ask()
    d.advance(CODE_TTL_MS + 1)
    d.type('4821')
    expect(d.replies.at(-1)).toEqual({ t: 'gate', to: 'v1', left: 0 })
    d.ask()
    expect(d.shown.at(-1)).toBe('7305')
    d.type('7305')
    expect(d.replies.at(-1)).toEqual({ t: 'admit', to: 'v1' })
  })

  it(`after ${CODE_TRIES} wrong codes, no more codes for that page`, () => {
    const d = door()
    d.ask()
    for (let i = 1; i <= CODE_TRIES; i++) {
      d.type('0000')
      expect(d.replies.at(-1)).toMatchObject({ left: CODE_TRIES - i })
    }
    expect(d.replies.at(-1)).toEqual({
      t: 'gate',
      to: 'v1',
      left: 0,
      spent: true,
    })
    expect(d.shown.at(-1)).toBe(null)
    // The right code, or a new one, is too late now
    d.type('4821')
    expect(d.replies.at(-1)).toMatchObject({ spent: true })
    d.ask()
    expect(d.replies.at(-1)).toMatchObject({ spent: true })
    expect(d.shown.filter(Boolean)).toEqual(['4821'])
    // A reload (a new connection) starts again
    d.ask('v2')
    expect(d.shown.at(-1)).toBe('7305')
  })

  it('tries count across codes, so asking anew never resets them', () => {
    const d = door()
    d.ask()
    for (let i = 0; i < CODE_TRIES - 1; i++) d.type('0000')
    d.advance(CODE_TTL_MS + 1)
    d.ask()
    d.type('0000')
    expect(d.replies.at(-1)).toMatchObject({ left: 0, spent: true })
  })

  it("one viewer's code doesn't open the door for another", () => {
    const d = door()
    d.ask('v1')
    d.type('4821', 'v2')
    expect(d.replies.at(-1)).toEqual({ t: 'gate', to: 'v2', left: 0 })
  })

  it('a viewer leaving hides its code', () => {
    const d = door()
    d.ask()
    d.gate.knock({ t: 'knock', from: 'v1', gone: true })
    expect(d.shown.at(-1)).toBe(null)
    d.type('4821')
    expect(d.replies.at(-1)).toMatchObject({ t: 'gate', left: 0 })
  })

  it('codes are 4 digits', () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{4}$/)
  })
})
