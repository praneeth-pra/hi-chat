import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadMessage } from '@janhq/core'
import {
  applyMirrorMessage,
  emptyMirror,
  mirrorMessages,
  mirrorSocketUrl,
  startRemoteMirror,
  streamUpdate,
} from '../remoteMirror'
import { useAppState } from '@/hooks/useAppState'
import { useMessages } from '@/hooks/useMessages'
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
  onopen?: () => void
  onmessage?: (e: { data: string }) => void
  onclose?: () => void
  constructor(public url: string) {
    FakeSocket.last = this
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
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

  it('builds the socket address from the page', () => {
    expect(
      mirrorSocketUrl({ protocol: 'https:', host: 'hi.example' }, 'view')
    ).toBe('wss://hi.example/api/mirror?role=view')
    expect(
      mirrorSocketUrl({ protocol: 'http:', host: 'localhost:1420' }, 'send')
    ).toBe('ws://localhost:1420/api/mirror?role=send')
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

    it('sends nothing until someone is watching', () => {
      const ws = start()
      expect(ws.url).toBe('wss://hi.example/api/mirror?role=send')
      useMessages.setState({
        messages: { t1: [msg('u', 'user', 'Hi again')] },
      })
      vi.advanceTimersByTime(100)
      expect(ws.sent).toEqual([])
    })

    it('sends the conversation, then the reply as it streams', () => {
      const ws = start()
      ws.hear({ t: 'viewers', n: 1 })
      vi.advanceTimersByTime(100)
      expect(ws.sent).toEqual([
        {
          t: 'snap',
          title: 'Plans',
          msgs: [{ id: 'u', role: 'user', text: 'Hi' }],
        },
      ])
      useAppState.setState({ streamingContent: msg('a', 'assistant', 'He') })
      vi.advanceTimersByTime(100)
      useAppState.setState({
        streamingContent: msg('a', 'assistant', 'Hello'),
      })
      vi.advanceTimersByTime(100)
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
      vi.advanceTimersByTime(100)
      expect(ws.sent.slice(3)).toEqual([
        {
          t: 'snap',
          title: 'Plans',
          msgs: [
            { id: 'u', role: 'user', text: 'Hi' },
            { id: 'a', role: 'assistant', text: 'Hello' },
          ],
        },
        { t: 'stream', id: null },
      ])
    })

    it('follows a reply whose id changes on every update, as the chat does', () => {
      const ws = start()
      ws.hear({ t: 'viewers', n: 1 })
      vi.advanceTimersByTime(100)
      // useChat builds each streamed update, and the saved reply, with a new id
      useAppState.setState({ streamingContent: msg('a1', 'assistant', 'He') })
      vi.advanceTimersByTime(100)
      useAppState.setState({
        streamingContent: msg('a2', 'assistant', 'Hello'),
      })
      vi.advanceTimersByTime(100)
      useAppState.setState({
        streamingContent: msg('a3', 'assistant', 'Hello there'),
      })
      vi.advanceTimersByTime(100)
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
      vi.advanceTimersByTime(100)
      expect(ws.sent.slice(4)).toEqual([
        {
          t: 'snap',
          title: 'Plans',
          msgs: [
            { id: 'u', role: 'user', text: 'Hi' },
            { id: 'a9', role: 'assistant', text: 'Hello there' },
          ],
        },
        { t: 'stream', id: null },
      ])

      // The viewer shows the reply once, never both the stream and the reply
      let s = emptyMirror
      for (const m of ws.sent.slice(0, 5)) s = applyMirrorMessage(s, m)
      expect(s.stream).toBeNull()
      expect(s.msgs.map((m) => m.text)).toEqual(['Hi', 'Hello there'])
    })

    it('does not run on the viewer page itself', () => {
      const before = FakeSocket.last
      stop = startRemoteMirror({
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
        location: {
          protocol: 'https:',
          host: 'hi.example',
          pathname: '/mirror',
        } as Location,
      })
      expect(FakeSocket.last).toBe(before)
    })

    it('does not run on the camera page, which opens the viewer', () => {
      const before = FakeSocket.last
      stop = startRemoteMirror({
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
        location: {
          protocol: 'https:',
          host: 'hi.example',
          pathname: '/camera',
        } as Location,
      })
      expect(FakeSocket.last).toBe(before)
    })

    it('stops sending once the page moves to the viewer', () => {
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
      location.pathname = '/mirror'
      ws.hear({ t: 'viewers', n: 1 })
      vi.advanceTimersByTime(100)
      expect(ws.sent).toEqual([])
    })
  })
})
