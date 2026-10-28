import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadMessage } from '@janhq/core'
import {
  applyMirrorMessage,
  diffMessages,
  emptyMirror,
  messageImages,
  mirrorShownTap,
  mirrorStreamTap,
  mirrorMessages,
  mirrorSocketUrl,
  readLook,
  readScroll,
  startRemoteMirror,
  streamUpdate,
} from '../remoteMirror'
import { markdownBlocks } from '../markdownBlocks'
import { useAppState } from '@/hooks/useAppState'
import { useMessages } from '@/hooks/useMessages'
import { usePrompt } from '@/hooks/usePrompt'
import { useThreads } from '@/hooks/useThreads'

const msg = (id: string, role: string, text: string) =>
  ({
    id,
    role,
    thread_id: 't1',
    content: [{ type: 'text', text: { value: text, annotations: [] } }],
  }) as unknown as ThreadMessage

class FakeSocket {
  static OPEN = 1
  static last: FakeSocket
  readyState = 0
  sent: unknown[] = []
  /** Each update's sequence number, in order (kept out of `sent`) */
  seqs: number[] = []
  onopen?: () => void
  onmessage?: (e: { data: string }) => void
  onclose?: () => void
  constructor(public url: string) {
    FakeSocket.last = this
  }
  send(data: string) {
    const { s, q, ...m } = JSON.parse(data)
    if (typeof q === 'number') {
      expect(typeof s).toBe('string')
      this.seqs.push(q)
    }
    this.sent.push(m)
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  hear(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

describe('remote mirror', () => {
  it('keeps only user and assistant text', () => {
    expect(
      mirrorMessages([
        msg('1', 'user', 'Hi'),
        msg('2', 'system', 'secret'),
        msg('3', 'assistant', 'Hello'),
      ])
    ).toEqual([
      { id: '1', role: 'user', text: 'Hi' },
      { id: '3', role: 'assistant', text: 'Hello' },
    ])
  })

  it('sends only what is new in a streaming reply', () => {
    const none = { id: null, text: '' }
    expect(streamUpdate(none, null, '')).toBeNull()
    expect(streamUpdate(none, 'a', 'He')).toEqual({
      t: 'stream',
      id: 'a',
      text: 'He',
    })
    expect(streamUpdate({ id: 'a', text: 'He' }, 'a', 'Hello')).toEqual({
      t: 'stream',
      id: 'a',
      add: 'llo',
    })
    expect(streamUpdate({ id: 'a', text: 'He' }, 'a', 'He')).toBeNull()
    // Rewritten text is sent whole
    expect(streamUpdate({ id: 'a', text: 'He' }, 'a', 'Ho')).toEqual({
      t: 'stream',
      id: 'a',
      text: 'Ho',
    })
    expect(streamUpdate({ id: 'a', text: 'He' }, null, '')).toEqual({
      t: 'stream',
      id: null,
    })
  })

  it('reads where the chat is scrolled to, by message', () => {
    const el = document.createElement('div')
    const box = (top: number, height: number) =>
      ({ top, bottom: top + height, height }) as DOMRect
    el.getBoundingClientRect = () => box(100, 500)
    Object.defineProperties(el, {
      scrollHeight: { value: 3000 },
      clientHeight: { value: 500 },
      scrollTop: { value: 1000, writable: true },
    })
    const tops = { u1: -300, a1: 0, u2: 400 } as Record<string, number>
    for (const [id, top] of Object.entries(tops)) {
      const m = document.createElement('div')
      m.dataset.testId = `message-${id[0] === 'u' ? 'user' : 'assistant'}-${id}`
      m.getBoundingClientRect = () => box(top, 400)
      el.append(m)
    }
    // a1 runs from 0 to 400, and the view's top is at 100: a quarter in,
    // exactly 100 px
    expect(readScroll(el)).toEqual({
      t: 'scroll',
      id: 'a1',
      f: 0.25,
      px: 100,
      h: 400,
    })
    // At the end of the chat it still says where, rather than "the end",
    // so a viewer doesn't jump between the two as you scroll near it
    el.scrollTop = 2490
    expect(readScroll(el)).toMatchObject({ id: 'a1', px: 100 })
  })

  it('viewer state keeps the exact scroll position', () => {
    const s = applyMirrorMessage(emptyMirror, {
      t: 'scroll',
      id: 'a1',
      f: 0.2,
      px: -8,
      h: 600,
    })
    expect(s.scroll).toEqual({ id: 'a1', f: 0.2, px: -8, h: 600 })
    // An older Hi-chat sends only the fraction
    expect(
      applyMirrorMessage(emptyMirror, { t: 'scroll', id: 'a1', f: 0.2 }).scroll
    ).toEqual({ id: 'a1', f: 0.2 })
  })

  it('viewer state keeps where Hi-chat is scrolled to', () => {
    let s = applyMirrorMessage(emptyMirror, { t: 'scroll', id: 'a1', f: 2 })
    expect(s.scroll).toEqual({ id: 'a1', f: 1 })
    s = applyMirrorMessage(s, { t: 'scroll', bottom: true })
    expect(s.scroll).toEqual({ bottom: true })
    expect(applyMirrorMessage(s, { t: 'scroll', id: 5 }).scroll).toEqual({
      bottom: true,
    })
  })

  it('builds the socket address from the page', () => {
    expect(
      mirrorSocketUrl({ protocol: 'https:', host: 'hi.example' }, 'view')
    ).toBe('wss://hi.example/api/mirror?role=view')
    expect(
      mirrorSocketUrl({ protocol: 'http:', host: 'localhost:1420' }, 'send')
    ).toBe('ws://localhost:1420/api/mirror?role=send')
    // An app sends to its own link too; a link's viewer has its own socket
    const link = 'L'.repeat(24)
    expect(
      mirrorSocketUrl({ protocol: 'https:', host: 'hi.example' }, 'send', link)
    ).toBe(`wss://hi.example/api/mirror?role=send&link=${link}`)
    expect(
      mirrorSocketUrl({ protocol: 'https:', host: 'hi.example' }, 'view', link)
    ).toBe(`wss://hi.example/api/mirror-link?link=${link}`)
    // with when it made its link, so the server ends it on time
    expect(
      mirrorSocketUrl(
        { protocol: 'https:', host: 'hi.example' },
        'send',
        link,
        1234.5
      )
    ).toBe(`wss://hi.example/api/mirror?role=send&link=${link}&born=1234`)
  })

  it('viewer state follows snapshots and streams', () => {
    let s = applyMirrorMessage(emptyMirror, { t: 'sender', on: true })
    s = applyMirrorMessage(s, {
      t: 'snap',
      title: 'Plans',
      msgs: [{ id: 'u', role: 'user', text: 'Hi' }],
    })
    s = applyMirrorMessage(s, { t: 'stream', id: 'a', text: 'He' })
    s = applyMirrorMessage(s, { t: 'stream', id: 'a', add: 'llo' })
    expect(s.stream).toEqual({ id: 'a', text: 'Hello' })
    expect(s.senderOn).toBe(true)
    s = applyMirrorMessage(s, {
      t: 'snap',
      title: 'Plans',
      msgs: [
        { id: 'u', role: 'user', text: 'Hi' },
        { id: 'a', role: 'assistant', text: 'Hello' },
      ],
    })
    expect(s.stream).toBeNull()
    expect(s.msgs).toHaveLength(2)
  })

  describe('sender', () => {
    let stop = () => {}
    beforeEach(() => {
      vi.useFakeTimers()
      useThreads.setState({
        currentThreadId: 't1',
        threads: { t1: { id: 't1', title: 'Plans' } },
      } as never)
      useMessages.setState({ messages: { t1: [msg('u', 'user', 'Hi')] } })
      useAppState.setState({ streamingContent: undefined })
    })
    afterEach(() => {
      stop()
      vi.useRealTimers()
    })

    const start = () => {
      stop = startRemoteMirror({
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
        location: {
          protocol: 'https:',
          host: 'hi.example',
          pathname: '/',
        } as Location,
      })
      const ws = FakeSocket.last
      ws.open()
      return ws
    }

    it('ends its link at 90 minutes and goes on with a new one', async () => {
      const ws = start()
      const link = new URL(ws.url.replace('wss:', 'https:')).searchParams.get(
        'link'
      )
      vi.advanceTimersByTime(90 * 60_000 + 15_000)
      expect(ws.sent).toContainEqual({ t: 'revoke', link })
      const next = FakeSocket.last
      expect(next).not.toBe(ws)
      const nextLink = new URL(
        next.url.replace('wss:', 'https:')
      ).searchParams.get('link')
      expect(nextLink).toMatch(/^[A-Za-z0-9_-]{24}$/)
      expect(nextLink).not.toBe(link)
    })

    it('sends nothing until someone is watching', async () => {
      const ws = start()
      // Signed in, it also sends to this app's own mirror link
      expect(ws.url).toMatch(
        /^wss:\/\/hi\.example\/api\/mirror\?role=send&link=[A-Za-z0-9_-]{24}&born=\d+$/
      )
      useMessages.setState({
        messages: { t1: [msg('u', 'user', 'Hi again')] },
      })
      await vi.advanceTimersByTimeAsync(100)
      expect(ws.sent).toEqual([])
    })

    it('sends the conversation, then the reply as it streams', async () => {
      const ws = start()
      ws.hear({ t: 'viewers', n: 1 })
      await vi.advanceTimersByTimeAsync(100)
      expect(ws.sent).toEqual([
        {
          t: 'snap',
          title: 'Plans',
          msgs: [{ id: 'u', role: 'user', text: 'Hi' }],
        },
      ])
      useAppState.setState({ streamingContent: msg('a', 'assistant', 'He') })
      await vi.advanceTimersByTimeAsync(100)
      useAppState.setState({
        streamingContent: msg('a', 'assistant', 'Hello'),
      })
      await vi.advanceTimersByTimeAsync(100)
      expect(ws.sent.slice(1)).toEqual([
        { t: 'stream', id: 'a', text: 'He' },
        { t: 'stream', id: 'a', add: 'llo' },
      ])
      useMessages.setState({
        messages: {
          t1: [msg('u', 'user', 'Hi'), msg('a', 'assistant', 'Hello')],
        },
      })
      useAppState.setState({ streamingContent: undefined })
      await vi.advanceTimersByTimeAsync(100)
      // Only what changed: the saved reply, appended
      expect(ws.sent.slice(3)).toEqual([
        {
          t: 'ops',
          title: 'Plans',
          set: [],
          add: [{ id: 'a', role: 'assistant', text: 'Hello' }],
        },
        { t: 'stream', id: null },
      ])
    })

    it('follows a reply whose id changes on every update, as the chat does', async () => {
      const ws = start()
      ws.hear({ t: 'viewers', n: 1 })
      await vi.advanceTimersByTimeAsync(100)
      // useChat builds each streamed update, and the saved reply, with a new id
      useAppState.setState({ streamingContent: msg('a1', 'assistant', 'He') })
      await vi.advanceTimersByTimeAsync(100)
      useAppState.setState({
        streamingContent: msg('a2', 'assistant', 'Hello'),
      })
      await vi.advanceTimersByTimeAsync(100)
      useAppState.setState({
        streamingContent: msg('a3', 'assistant', 'Hello there'),
      })
      await vi.advanceTimersByTimeAsync(100)
      expect(ws.sent.slice(1)).toEqual([
        { t: 'stream', id: 'a1', text: 'He' },
        { t: 'stream', id: 'a1', add: 'llo' },
        { t: 'stream', id: 'a1', add: ' there' },
      ])
      useMessages.setState({
        messages: {
          t1: [msg('u', 'user', 'Hi'), msg('a9', 'assistant', 'Hello there')],
        },
      })
      useAppState.setState({ streamingContent: undefined })
      await vi.advanceTimersByTimeAsync(100)
      expect(ws.sent.slice(4)).toEqual([
        {
          t: 'ops',
          title: 'Plans',
          set: [],
          add: [{ id: 'a9', role: 'assistant', text: 'Hello there' }],
        },
        { t: 'stream', id: null },
      ])

      // The viewer shows the reply once, never both the stream and the reply
      let s = emptyMirror
      for (const m of ws.sent.slice(0, 5)) s = applyMirrorMessage(s, m)
      expect(s.stream).toBeNull()
      expect(s.msgs.map((m) => m.text)).toEqual(['Hi', 'Hello there'])
    })

    it("sends what's typed in the message box", async () => {
      const ws = start()
      ws.hear({ t: 'viewers', n: 1 })
      await vi.advanceTimersByTimeAsync(100)
      usePrompt.setState({ prompt: 'And then' })
      await vi.advanceTimersByTimeAsync(100)
      usePrompt.setState({ prompt: 'And then?' })
      await vi.advanceTimersByTimeAsync(100)
      expect(ws.sent.slice(1)).toEqual([
        { t: 'typing', text: 'And then' },
        { t: 'typing', text: 'And then?' },
      ])
      usePrompt.setState({ prompt: '' })
    })

    it('does not run on the viewer page itself', async () => {
      const before = FakeSocket.last
      stop = startRemoteMirror({
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
        location: {
          protocol: 'https:',
          host: 'hi.example',
          pathname: `/m/${'L'.repeat(24)}`,
        } as Location,
      })
      expect(FakeSocket.last).toBe(before)
    })

    it('stops sending once the page moves to the viewer', async () => {
      const location = {
        protocol: 'https:',
        host: 'hi.example',
        pathname: '/',
      } as Location
      stop = startRemoteMirror({
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
        location,
      })
      const ws = FakeSocket.last
      ws.open()
      location.pathname = `/m/${'L'.repeat(24)}`
      ws.hear({ t: 'viewers', n: 1 })
      await vi.advanceTimersByTimeAsync(100)
      expect(ws.sent).toEqual([])
    })
  })
})

describe('mirror: what it shows, and sending only what changed', () => {
  it('shows what Hi-chat shows for each message', () => {
    const user = {
      id: 'u',
      role: 'user',
      thread_id: 't1',
      content: [
        { type: 'text', text: { value: 'What is this?', annotations: [] } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      ],
    } as unknown as ThreadMessage
    const answer = {
      id: 'a',
      role: 'assistant',
      thread_id: 't1',
      status: 'stopped',
      content: [
        {
          type: 'text',
          text: { value: '<think>hmm</think>A chart', annotations: [] },
        },
      ],
      metadata: {
        accuracyReview: {
          verdict: 'approved',
          verifier: 'gpt-oss-120b',
          webStatus: 'ready',
          sources: [{ title: 'Docs', url: 'https://example.com' }],
          model: 'x',
          reviewMs: 1,
          draftMs: 1,
        },
        tool_calls: [
          { tool: { function: { name: 'search' } }, state: 'pending' },
        ],
      },
    } as unknown as ThreadMessage
    expect(mirrorMessages([user, answer])).toEqual([
      { id: 'u', role: 'user', text: 'What is this?', images: ['u.0'] },
      {
        id: 'a',
        role: 'assistant',
        text: '<think>hmm</think>A chart',
        stopped: true,
        review: {
          verdict: 'approved',
          fallback: undefined,
          verifier: 'gpt-oss-120b',
          webStatus: 'ready',
          sources: [{ title: 'Docs', url: 'https://example.com' }],
        },
        tools: [{ name: 'search', pending: true }],
      },
    ])
    expect([...messageImages([user, answer])]).toEqual([
      ['u.0', 'data:image/png;base64,AAA'],
    ])
  })

  it('finds what changed: replaced and appended messages', () => {
    const a = { id: 'a', role: 'user' as const, text: 'Hi' }
    const b = { id: 'b', role: 'assistant' as const, text: 'Hello' }
    const b2 = { ...b, text: 'Hello!' }
    const c = { id: 'c', role: 'user' as const, text: 'More' }
    const json = (l: object[]) => l.map((x) => JSON.stringify(x))
    expect(
      diffMessages(['a', 'b'], json([a, b]), [a, b, c], json([a, b, c]))
    ).toEqual({ set: [], add: [c] })
    expect(
      diffMessages(['a', 'b'], json([a, b]), [a, b2], json([a, b2]))
    ).toEqual({ set: [b2], add: [] })
    // A deleted or different message: send it all
    expect(diffMessages(['a', 'b'], json([a, b]), [a], json([a]))).toBeNull()
    expect(
      diffMessages(['a', 'b'], json([a, b]), [a, c], json([a, c]))
    ).toBeNull()
  })

  it('viewer applies changes, keeping unchanged messages as they were', () => {
    let s = applyMirrorMessage(emptyMirror, {
      t: 'snap',
      title: 'Plans',
      msgs: [
        { id: 'a', role: 'user', text: 'Hi' },
        { id: 'b', role: 'assistant', text: 'Hello' },
      ],
    })
    s = applyMirrorMessage(s, { t: 'scroll', id: 'b', f: 0.5 })
    const first = s.msgs[0]
    s = applyMirrorMessage(s, {
      t: 'ops',
      title: 'Plans',
      set: [{ id: 'b', role: 'assistant', text: 'Hello!' }],
      add: [{ id: 'c', role: 'user', text: 'More' }],
    })
    expect(s.msgs.map((m) => m.text)).toEqual(['Hi', 'Hello!', 'More'])
    expect(s.msgs[0]).toBe(first) // not drawn again
    // Scroll sync is untouched by content updates
    expect(s.scroll).toEqual({ id: 'b', f: 0.5 })
    s = applyMirrorMessage(s, { t: 'img', key: 'a.0', src: 'data:x' })
    expect(s.images).toEqual({ 'a.0': 'data:x' })
    s = applyMirrorMessage(s, { t: 'phase', phase: 'searching' })
    expect(s.phase).toBe('searching')
    s = applyMirrorMessage(s, { t: 'phase', phase: 'nonsense' })
    expect(s.phase).toBeNull()
  })

  it('splits streaming markdown into blocks, never inside code', () => {
    expect(
      markdownBlocks('One\n\nTwo\nlines\n\n```\na\n\nb\n```\n\nEnd')
    ).toEqual(['One', 'Two\nlines', '```\na\n\nb\n```', 'End'])
    expect(markdownBlocks('')).toEqual([''])
  })
})

describe('mirror: a reply goes out the moment it arrives', () => {
  let stop = () => {}
  beforeEach(() => {
    vi.useFakeTimers()
    useThreads.setState({
      currentThreadId: 't1',
      threads: { t1: { id: 't1', title: 'Plans' } },
    } as never)
    useMessages.setState({ messages: { t1: [msg('u', 'user', 'Hi')] } })
    useAppState.setState({
      streamingContent: undefined,
      accuracyStatus: undefined,
    })
  })
  afterEach(() => {
    stop()
    vi.useRealTimers()
  })

  it('sends each piece from the model at once, and never goes back', async () => {
    stop = startRemoteMirror({
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      location: {
        protocol: 'https:',
        host: 'hi.example',
        pathname: '/',
      } as Location,
    })
    const ws = FakeSocket.last
    ws.open()
    ws.hear({ t: 'viewers', n: 1 })
    await vi.advanceTimersByTimeAsync(0)
    const before = ws.sent.length
    // Straight from the model: sent synchronously, no frame or timer
    mirrorStreamTap('t1', 'He')
    mirrorStreamTap('t1', 'Hello')
    expect(ws.sent.slice(before)).toEqual([
      { t: 'stream', id: 'reply-1', text: 'He' },
      { t: 'stream', id: 'reply-1', add: 'llo' },
    ])
    // Hi-chat's own drawing lags behind: nothing to resend
    useAppState.setState({ streamingContent: msg('x1', 'assistant', 'Hel') })
    await vi.advanceTimersByTimeAsync(0)
    expect(ws.sent.length).toBe(before + 2)
    // Another chat's reply isn't this mirror's
    mirrorStreamTap('t2', 'Other')
    expect(ws.sent.length).toBe(before + 2)
    // Accuracy progress shows as it changes
    useAppState.setState({
      accuracyStatus: { threadId: 't1', phase: 'verifying' },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(ws.sent.at(-1)).toEqual({ t: 'phase', phase: 'verifying' })
    // Every update is numbered in order, for the direct channel's viewers
    expect(ws.seqs.length).toBeGreaterThan(2)
    expect(ws.seqs).toEqual(ws.seqs.map((_, i) => i + 1))
  })

  it('streams a reply under the id its saved message keeps', async () => {
    stop = startRemoteMirror({
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      location: {
        protocol: 'https:',
        host: 'hi.example',
        pathname: '/',
      } as Location,
    })
    const ws = FakeSocket.last
    ws.open()
    ws.hear({ t: 'viewers', n: 1 })
    await vi.advanceTimersByTimeAsync(0)
    const before = ws.sent.length
    // The chat's placeholder for the reply carries the id it is saved under
    useAppState.setState({
      streamingContent: { ...msg('a1', 'assistant', ''), thread_id: 't1' },
    })
    mirrorStreamTap('t1', 'He')
    mirrorStreamTap('t1', 'Hello')
    expect(ws.sent.slice(before)).toEqual([
      { t: 'stream', id: 'a1', text: 'He' },
      { t: 'stream', id: 'a1', add: 'llo' },
    ])
    // So the viewer ends the stream into that same message
    let view = applyMirrorMessage(emptyMirror, ws.sent[before])
    view = applyMirrorMessage(view, ws.sent[before + 1])
    view = applyMirrorMessage(view, {
      t: 'ops',
      set: [],
      add: [{ id: 'a1', role: 'assistant', text: 'Hello' }],
    })
    expect(view.stream).toBeNull()
    expect(view.msgs.map((m) => m.id)).toEqual(['a1'])
  })

  it('tells viewers how much of the reply Hi-chat shows, in step', async () => {
    stop = startRemoteMirror({
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      location: {
        protocol: 'https:',
        host: 'hi.example',
        pathname: '/',
      } as Location,
    })
    const ws = FakeSocket.last
    ws.open()
    ws.hear({ t: 'viewers', n: 1 })
    await vi.advanceTimersByTimeAsync(0)
    useAppState.setState({
      streamingContent: { ...msg('a1', 'assistant', ''), thread_id: 't1' },
    })
    mirrorStreamTap('t1', 'Hello there')
    const before = ws.sent.length
    mirrorShownTap('t1', 'a1', 5)
    mirrorShownTap('t1', 'a1', 5) // the same again: nothing new
    mirrorShownTap('t1', 'old', 3) // an older answer: not followed
    mirrorShownTap('t2', 'a1', 7) // another chat
    mirrorShownTap('t1', 'a1', 11)
    expect(ws.sent.slice(before)).toEqual([
      { t: 'shown', id: 'a1', n: 5 },
      { t: 'shown', id: 'a1', n: 11 },
    ])
    // Numbered with the rest, so each arrives once by either route
    expect(ws.seqs.at(-1)).toBe(ws.seqs.length)
  })

  it('viewer state keeps how much is shown, never going back', () => {
    let view = applyMirrorMessage(emptyMirror, { t: 'shown', id: 'a1', n: 9 })
    expect(view.shown).toEqual({ id: 'a1', n: 9 })
    // A late copy from the other route says less: ignored
    expect(applyMirrorMessage(view, { t: 'shown', id: 'a1', n: 4 })).toBe(view)
    view = applyMirrorMessage(view, { t: 'shown', id: 'a2', n: 2 })
    expect(view.shown).toEqual({ id: 'a2', n: 2 })
    expect(applyMirrorMessage(view, { t: 'shown', id: 'a2', n: 'x' })).toBe(
      view
    )
  })

  it("doesn't lay the chat out again for every streamed piece", async () => {
    // Measuring the scroll position forces a layout: only when the
    // conversation changes, on the next frame, never per streamed piece
    const raf = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 16)) as typeof requestAnimationFrame
    const scroller = document.createElement('div')
    scroller.setAttribute('data-thread-scroller', '')
    document.body.appendChild(scroller)
    // Reading scrollHeight is what makes the browser lay the chat out
    const measure = vi.fn(() => 0)
    Object.defineProperty(scroller, 'scrollHeight', { get: measure })
    try {
      stop = startRemoteMirror({
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
        location: {
          protocol: 'https:',
          host: 'hi.example',
          pathname: '/',
        } as Location,
      })
      const ws = FakeSocket.last
      ws.open()
      ws.hear({ t: 'viewers', n: 1 })
      await vi.advanceTimersByTimeAsync(50)
      // A new viewer gets where the chat is
      expect(ws.sent.some((m) => (m as { t: string }).t === 'scroll')).toBe(
        true
      )
      measure.mockClear()
      // An answer streams: many updates, no layout
      for (let i = 1; i <= 30; i++) {
        useAppState.setState({
          streamingContent: msg('x1', 'assistant', 'word '.repeat(i)),
        })
        await vi.advanceTimersByTimeAsync(0)
      }
      await vi.advanceTimersByTimeAsync(50)
      expect(measure).not.toHaveBeenCalled()
      // The conversation changes: measured once, on the next frame
      useMessages.setState({
        messages: {
          t1: [msg('u', 'user', 'Hi'), msg('a', 'assistant', 'Hello')],
        },
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(measure).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(20)
      expect(measure).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.requestAnimationFrame = raf
      scroller.remove()
    }
  })

  it("viewer takes Hi-chat's look and its message box", () => {
    let s = applyMirrorMessage(emptyMirror, {
      t: 'look',
      width: 768,
      dark: true,
      vars: { '--font-size-base': '16px', '--x': 'url(a.png)', 'bad': 'red' },
    })
    expect(s.look).toEqual({
      width: 768,
      dark: true,
      vars: { '--font-size-base': '16px' },
    })
    s = applyMirrorMessage(s, { t: 'typing', text: 'Why' })
    expect(s.typing).toBe('Why')
  })

  it("reads the chat's look: its variables, theme and column", () => {
    const root = document.createElement('div')
    root.style.setProperty('--font-size-base', '16px')
    root.style.setProperty('color', 'red')
    root.classList.add('dark')
    const scroller = document.createElement('div')
    const column = document.createElement('div')
    Object.defineProperty(column, 'clientWidth', { value: 768 })
    scroller.appendChild(column)
    expect(readLook(root, scroller)).toEqual({
      t: 'look',
      width: 768,
      dark: true,
      vars: { '--font-size-base': '16px' },
    })
  })
})
