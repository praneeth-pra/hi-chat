import { describe, expect, it } from 'vitest'
import { chunks, createSeqFilter, createUnchunker } from '../mirrorDirect'

describe('direct mirror', () => {
  it('sends a long message in pieces and puts it back together', () => {
    const long = JSON.stringify({ t: 'snap', text: 'x'.repeat(150_000) })
    const pieces = chunks(long)
    expect(pieces.length).toBe(3)
    expect(pieces.slice(0, -1).every((p) => p[0] === '~')).toBe(true)
    expect(pieces.at(-1)?.[0]).toBe('!')
    const got: string[] = []
    const take = createUnchunker((d) => got.push(d))
    for (const p of pieces) take(p)
    take('{"t":"stream"}')
    expect(got).toEqual([long, '{"t":"stream"}'])
    expect(chunks('{"t":"a"}')).toEqual(['{"t":"a"}'])
  })

  it('applies each update once, in order, from whichever route can', () => {
    const f = createSeqFilter()
    const u = (q: number) => ({ t: 'stream', s: 'a', q })
    const qs = (list: { q?: unknown }[]) => list.map((m) => m.q)
    // The server's catch-up, images, older senders: always
    expect(f.take({ t: 'snap' }, 'relay')).toEqual([{ t: 'snap' }])
    // A viewer joining mid-way starts from the server's next update
    expect(qs(f.take(u(5), 'relay'))).toEqual([5])
    // The direct route opens: its copy of the next update is first
    expect(qs(f.take(u(6), 'direct'))).toEqual([6])
    expect(f.take(u(6), 'relay')).toEqual([])
    // The server's copy is sometimes first: the direct one is then dropped
    expect(qs(f.take(u(7), 'relay'))).toEqual([7])
    expect(f.take(u(7), 'direct')).toEqual([])
    // A direct copy ahead of the rest waits, then follows at once
    expect(f.take(u(9), 'direct')).toEqual([])
    expect(f.take(u(10), 'direct')).toEqual([])
    expect(qs(f.take(u(8), 'relay'))).toEqual([8, 9, 10])
    expect(f.take(u(9), 'relay')).toEqual([])
    expect(qs(f.take(u(11), 'direct'))).toEqual([11])
    // Another sender (a second Hi-chat window) has its own numbers
    expect(qs(f.take({ t: 'scroll', s: 'b', q: 1 }, 'relay'))).toEqual([1])
  })

  it('every update arrives once, in order, however the routes interleave', () => {
    for (let run = 0; run < 500; run++) {
      const f = createSeqFilter()
      const joined = 1 + Math.floor(Math.random() * 5)
      const opened = joined + Math.floor(Math.random() * 10)
      // The server route from when this viewer joined, the direct one from
      // when it opened; each in order
      const relay = Array.from({ length: 40 }, (_, i) => i + 1).filter(
        (q) => q >= joined
      )
      const direct = relay.filter((q) => q >= opened)
      const applied: unknown[] = []
      let i = 0
      let j = 0
      while (i < relay.length || j < direct.length) {
        const useDirect =
          j < direct.length && (i >= relay.length || Math.random() < 0.7)
        const q = useDirect ? direct[j++] : relay[i++]
        for (const m of f.take({ s: 'a', q }, useDirect ? 'direct' : 'relay'))
          applied.push(m.q)
      }
      expect(applied).toEqual(relay)
    }
  })
})
