import { describe, it, expect, vi } from 'vitest'
import {
  AssemblyLiveTranscriber,
  GrokLiveTranscriber,
  ASSEMBLY_LIVE_MODEL,
  ASSEMBLY_LIVE_URL,
  LiveTranscriber,
  LIVE_URL,
  toPcm16Base64,
} from '../speakerLive'

class FakeSocket {
  readyState = 0
  sent: Record<string, unknown>[] = []
  closed = false
  onopen: ((ev: Event) => unknown) | null = null
  onmessage: ((ev: MessageEvent) => unknown) | null = null
  onerror: ((ev: Event) => unknown) | null = null
  onclose: ((ev: CloseEvent) => unknown) | null = null
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.closed = true
  }
  open() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }
  reply(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent)
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('speakerLive', () => {
  it('encodes float samples as 16-bit little-endian PCM', () => {
    const bytes = atob(toPcm16Base64(new Float32Array([0, 1, -1])))
    const codes = [...bytes].map((c) => c.charCodeAt(0))
    expect(codes).toEqual([0, 0, 0xff, 0x7f, 0x00, 0x80])
  })

  it('streams audio held before the socket opens, commits, and returns the text', async () => {
    let socket!: FakeSocket
    const live = new LiveTranscriber(Promise.resolve('sutkn_1'), (url) => {
      socket = new FakeSocket(url)
      return socket as unknown as WebSocket
    })
    live.push(new Float32Array(1600))
    await tick()
    expect(socket.url.startsWith(`${LIVE_URL}?`)).toBe(true)
    const params = new URL(socket.url).searchParams
    expect(params.get('token')).toBe('sutkn_1')
    expect(params.get('model_id')).toBe('scribe_v2_realtime')
    expect(params.get('language_code')).toBe('en')
    expect(params.get('commit_strategy')).toBe('manual')
    expect(params.get('no_verbatim')).toBe('true')
    expect(socket.sent).toHaveLength(0)

    socket.open()
    expect(socket.sent).toHaveLength(1)
    live.push(new Float32Array(100))
    const text = live.finish()
    expect(socket.sent[1]).toMatchObject({
      message_type: 'input_audio_chunk',
      commit: true,
    })
    socket.reply({ message_type: 'partial_transcript', text: 'What is' })
    socket.reply({ message_type: 'committed_transcript', text: 'What is AKS?' })
    await expect(text).resolves.toBe('What is AKS?')
    expect(socket.closed).toBe(true)
  })

  it('keeps segments ElevenLabs committed by itself before the pause', async () => {
    let socket!: FakeSocket
    const live = new LiveTranscriber(Promise.resolve('t'), (url) => {
      socket = new FakeSocket(url)
      return socket as unknown as WebSocket
    })
    await tick()
    socket.open()
    socket.reply({
      message_type: 'committed_transcript',
      text: 'If the route table points',
    })
    const text = live.finish()
    socket.reply({
      message_type: 'committed_transcript',
      text: 'to NAT gateway, it is private.',
    })
    await expect(text).resolves.toBe(
      'If the route table points to NAT gateway, it is private.'
    )
  })

  it('rejects when ElevenLabs reports an error', async () => {
    let socket!: FakeSocket
    const live = new LiveTranscriber(Promise.resolve('t'), (url) => {
      socket = new FakeSocket(url)
      return socket as unknown as WebSocket
    })
    await tick()
    socket.open()
    const text = live.finish()
    socket.reply({ message_type: 'auth_error', error: 'bad token' })
    await expect(text).rejects.toThrow('bad token')
  })

  it('rejects when the token cannot be fetched or the text is late', async () => {
    const noToken = new LiveTranscriber(Promise.reject(new Error('401')))
    await tick()
    await expect(noToken.finish()).rejects.toThrow('401')

    vi.useFakeTimers()
    const slow = new LiveTranscriber(new Promise(() => {}))
    const text = slow.finish(1000)
    vi.advanceTimersByTime(1000)
    await expect(text).rejects.toThrow('too long')
    vi.useRealTimers()
  })
})

describe('AssemblyLiveTranscriber', () => {
  const connect = () => {
    let socket!: FakeSocket
    const live = new AssemblyLiveTranscriber(Promise.resolve('aai'), (url) => {
      socket = new FakeSocket(url)
      return socket as unknown as WebSocket
    })
    return { live, socket: () => socket }
  }
  class BinarySocket extends FakeSocket {
    raw: (ArrayBuffer | string)[] = []
    send(data: string) {
      this.raw.push(data)
    }
  }

  it('streams PCM, ends the turn, closes and joins every turn', async () => {
    let socket!: BinarySocket
    const live = new AssemblyLiveTranscriber(Promise.resolve('aai'), (url) => {
      socket = new BinarySocket(url)
      return socket as unknown as WebSocket
    })
    live.push(new Float32Array(1600))
    await tick()
    const params = new URL(socket.url).searchParams
    expect(socket.url.startsWith(`${ASSEMBLY_LIVE_URL}?`)).toBe(true)
    expect(params.get('token')).toBe('aai')
    expect(params.get('speech_model')).toBe(ASSEMBLY_LIVE_MODEL)
    expect(params.get('encoding')).toBe('pcm_s16le')
    expect(params.get('sample_rate')).toBe('16000')
    socket.open()
    expect((socket.raw[0] as ArrayBuffer).byteLength).toBe(3200)

    // AssemblyAI ended the first turn on its own at a short pause
    socket.reply({ type: 'Turn', turn_order: 0, transcript: 'If the route' })
    socket.reply({
      type: 'Turn',
      turn_order: 0,
      transcript: 'If the route table points',
      end_of_turn: true,
    })
    live.push(new Float32Array(100))
    const text = live.finish()
    // The last block is padded to AssemblyAI's 50 ms minimum
    expect((socket.raw[1] as ArrayBuffer).byteLength).toBe(1600)
    expect(socket.raw.slice(2)).toEqual([
      JSON.stringify({ type: 'ForceEndpoint' }),
      JSON.stringify({ type: 'Terminate' }),
    ])
    socket.reply({
      type: 'Turn',
      turn_order: 1,
      transcript: 'to a NAT gateway, is it private?',
      end_of_turn: true,
    })
    socket.reply({ type: 'Termination' })
    await expect(text).resolves.toBe(
      'If the route table points to a NAT gateway, is it private?'
    )
    expect(socket.closed).toBe(true)
  })

  it('rejects on an error, and when it closes before finishing', async () => {
    const a = connect()
    await tick()
    a.socket().open()
    const text = a.live.finish()
    a.socket().reply({ error: 'bad token' })
    await expect(text).rejects.toThrow('bad token')

    const b = connect()
    await tick()
    b.socket().open()
    b.socket().onclose?.({} as CloseEvent)
    await expect(b.live.finish()).rejects.toThrow('closed early')
  })

  it('keeps the turns it has if Termination never comes', async () => {
    vi.useFakeTimers()
    try {
      const a = connect()
      await Promise.resolve()
      await Promise.resolve()
      a.socket().open()
      a.socket().reply({
        type: 'Turn',
        turn_order: 0,
        transcript: 'What is EKS?',
      })
      const text = a.live.finish(1000)
      vi.advanceTimersByTime(1000)
      await expect(text).resolves.toBe('What is EKS?')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('GrokLiveTranscriber', () => {
  class GrokSocket extends FakeSocket {
    raw: (ArrayBuffer | string)[] = []
    send(data: string) {
      this.raw.push(data)
    }
  }
  const connect = async () => {
    let socket!: GrokSocket
    const live = new GrokLiveTranscriber(
      Promise.resolve('abc123'),
      (url) => {
        socket = new GrokSocket(url)
        return socket as unknown as WebSocket
      },
      'https://chat.example'
    )
    await tick()
    return { live, socket }
  }

  it('adds key terms to the relay URL', async () => {
    let url = ''
    new GrokLiveTranscriber(
      Promise.resolve('abc123'),
      (u) => {
        url = u
        return new GrokSocket(u) as unknown as WebSocket
      },
      'https://chat.example',
      ['NAT gateway', 'VPC']
    )
    await tick()
    expect(url).toBe(
      'wss://chat.example/api/grok-live?ticket=abc123&keyterm=NAT+gateway&keyterm=VPC'
    )
  })

  it('streams through the relay with a ticket and keeps every stretch', async () => {
    const { live, socket } = await connect()
    expect(socket.url).toBe('wss://chat.example/api/grok-live?ticket=abc123')
    live.push(new Float32Array(1600))
    socket.open()
    expect((socket.raw[0] as ArrayBuffer).byteLength).toBe(3200)
    socket.reply({
      type: 'transcript.partial',
      text: 'If the route table',
      is_final: true,
      speech_final: false,
    })
    socket.reply({
      type: 'transcript.partial',
      text: 'If the route table points to a NAT gateway,',
      is_final: true,
      speech_final: true,
    })
    socket.reply({
      type: 'transcript.partial',
      text: 'is it private?',
      is_final: true,
      speech_final: false,
    })
    const text = live.finish()
    expect(socket.raw.at(-1)).toBe(JSON.stringify({ type: 'audio.done' }))
    // transcript.done with only the last stretch: earlier ones are kept
    socket.reply({ type: 'transcript.done', text: 'is it private?' })
    await expect(text).resolves.toBe(
      'If the route table points to a NAT gateway, is it private?'
    )
    expect(socket.closed).toBe(true)
  })

  it('uses transcript.done when it repeats the whole clip', async () => {
    const { live, socket } = await connect()
    socket.open()
    socket.reply({
      type: 'transcript.partial',
      text: 'What is',
      is_final: true,
      speech_final: true,
    })
    const text = live.finish()
    socket.reply({ type: 'transcript.done', text: 'What is EKS?' })
    await expect(text).resolves.toBe('What is EKS?')
  })

  it('keeps spaces between stretches when transcript.done runs them together', async () => {
    const { live, socket } = await connect()
    socket.open()
    socket.reply({
      type: 'transcript.partial',
      text: 'I said that.',
      is_final: true,
      speech_final: true,
    })
    const text = live.finish()
    socket.reply({
      type: 'transcript.done',
      text: 'I said that.And have a look.',
    })
    await expect(text).resolves.toBe('I said that. And have a look.')
  })

  it('rejects when the relay reports an error', async () => {
    const { live, socket } = await connect()
    socket.open()
    const text = live.finish()
    socket.reply({ type: 'error', message: 'XAI_API_KEY not set' })
    await expect(text).rejects.toThrow('XAI_API_KEY not set')
  })
})
