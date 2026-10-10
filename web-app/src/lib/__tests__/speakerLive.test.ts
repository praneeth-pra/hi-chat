import { describe, it, expect, vi } from 'vitest'
import {
  AssemblyLiveTranscriber,
  GrokLiveTranscriber,
  ASSEMBLY_LIVE_MODEL,
  ASSEMBLY_LIVE_URL,
  LiveTranscriber,
  LIVE_URL,
  CartesiaLiveTranscriber,
  GeminiLiveTranscriber,
  joinPieces,
  sameStretch,
  elevenLabsTerms,
  cartesiaTerms,
  SONIOX_LIVE_URL,
  SonioxLiveTranscriber,
  sonioxTerms,
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

describe('SonioxLiveTranscriber', () => {
  class SonioxSocket extends FakeSocket {
    raw: (ArrayBuffer | string)[] = []
    send(data: string) {
      this.raw.push(data)
    }
  }
  const connect = async () => {
    let socket!: SonioxSocket
    const live = new SonioxLiveTranscriber(
      Promise.resolve({ token: 'temp:1', terms: ['kubectl', 'S3 bucket'] }),
      (url) => {
        socket = new SonioxSocket(url)
        return socket
      },
      ['VPC', 'kubectl']
    )
    await tick()
    return { live, socket }
  }

  it('sends the config with the dictionary first, then audio, and joins the final words', async () => {
    const { live, socket } = await connect()
    expect(socket.url).toBe(SONIOX_LIVE_URL)
    live.push(new Float32Array(1600).fill(0.1)) // held until open
    socket.open()
    const config = JSON.parse(socket.raw[0] as string)
    expect(config).toMatchObject({
      api_key: 'temp:1',
      model: 'stt-rt-v5',
      audio_format: 'pcm_s16le',
      sample_rate: 16000,
      num_channels: 1,
      language_hints: ['en'],
      context: { terms: ['kubectl', 'S3 bucket', 'VPC'] },
    })
    expect(socket.raw[1]).toBeInstanceOf(ArrayBuffer)
    socket.reply({
      tokens: [
        { text: 'What', is_final: true },
        { text: ' is', is_final: true },
        { text: ' a', is_final: false },
      ],
    })
    const text = live.finish()
    expect(socket.raw.at(-1)).toBe('') // end of audio
    socket.reply({
      tokens: [
        { text: ' an', is_final: true },
        { text: ' S3 bucket?', is_final: true },
        { text: '<fin>', is_final: true },
      ],
    })
    socket.reply({ tokens: [], finished: true })
    await expect(text).resolves.toBe('What is an S3 bucket?')
    expect(socket.closed).toBe(true)
  })

  it('fails on a Soniox error', async () => {
    const { live, socket } = await connect()
    socket.open()
    const text = live.finish()
    socket.reply({ error_code: 401, error_message: 'Invalid API key' })
    await expect(text).rejects.toThrow('Soniox live: Invalid API key')
  })

  it('fails when the relay has no Soniox key', async () => {
    const live = new SonioxLiveTranscriber(
      Promise.reject(new Error('Live token failed (503)')),
      () => new SonioxSocket('x')
    )
    await tick()
    await expect(live.finish()).rejects.toThrow('503')
  })

  it('cuts terms to fit Soniox context', () => {
    const many = Array.from({ length: 2000 }, (_, i) => `term number ${i}`)
    const out = sonioxTerms(many)
    expect(out.join(', ').length).toBeLessThan(9000)
    expect(out[0]).toBe('term number 0')
  })
})

describe('CartesiaLiveTranscriber', () => {
  class CartesiaSocket extends FakeSocket {
    raw: (ArrayBuffer | string)[] = []
    send(data: string) {
      this.raw.push(data)
    }
  }
  const connect = async () => {
    let socket!: CartesiaSocket
    const live = new CartesiaLiveTranscriber(
      Promise.resolve({ token: 'cart_tok', terms: ['kubectl', 'S3 bucket'] }),
      (url) => {
        socket = new CartesiaSocket(url)
        return socket
      },
      ['VPC']
    )
    await tick()
    return { live, socket }
  }

  it('connects with the token and key terms, joins final pieces, and ends on flush_done', async () => {
    const { live, socket } = await connect()
    const url = new URL(socket.url)
    expect(url.origin + url.pathname).toBe(
      'wss://api.cartesia.ai/stt/websocket'
    )
    expect(url.searchParams.get('model')).toBe('ink-2')
    expect(url.searchParams.get('encoding')).toBe('pcm_s16le')
    expect(url.searchParams.get('sample_rate')).toBe('16000')
    expect(url.searchParams.get('access_token')).toBe('cart_tok')
    expect(url.searchParams.getAll('keyterm')).toEqual([
      'VPC',
      'kubectl',
      'S3 bucket',
    ])
    live.push(new Float32Array(1600).fill(0.1))
    socket.open()
    expect(socket.raw[0]).toBeInstanceOf(ArrayBuffer)
    socket.reply({ type: 'transcript', is_final: true, text: 'What is' })
    socket.reply({ type: 'transcript', is_final: false, text: ' an S3' })
    const text = live.finish()
    expect(socket.raw.at(-1)).toBe('finalize')
    socket.reply({ type: 'transcript', is_final: true, text: ' an S3 bucket?' })
    socket.reply({ type: 'flush_done', request_id: 'r' })
    await expect(text).resolves.toBe('What is an S3 bucket?')
    expect(socket.raw.at(-1)).toBe('close')
    expect(socket.closed).toBe(true)
  })

  it('fails on a Cartesia error', async () => {
    const { live, socket } = await connect()
    socket.open()
    const text = live.finish()
    socket.reply({ type: 'error', status_code: 401, message: 'Bad token' })
    await expect(text).rejects.toThrow('Cartesia live: Bad token')
  })

  it('fits the dictionary into 100 terms, technical words first', () => {
    const dictionary = [
      'environment',
      'ec2 instance',
      'RBAC',
      'kubectl',
      ...Array.from({ length: 300 }, (_, i) => `word${i}`),
    ]
    const out = cartesiaTerms(dictionary, ['Grafana'])
    expect(out).toHaveLength(100)
    expect(out.slice(0, 3)).toEqual(['Grafana', 'RBAC', 'word0'])
    expect(out.join('').length).toBeLessThanOrEqual(1200)
  })
})

describe('elevenLabsTerms', () => {
  it('keeps the top 50 terms that fit 20 characters', () => {
    const terms = [
      'Horizontal Pod Autoscaler',
      ...Array.from({ length: 60 }, (_, i) => `t${i}`),
    ]
    const out = elevenLabsTerms(terms)
    expect(out).toHaveLength(50)
    expect(out[0]).toBe('t0')
  })

  it('sends them as keyterms on the ElevenLabs socket', async () => {
    let url = ''
    new LiveTranscriber(
      Promise.resolve('tok'),
      (u) => {
        url = u
        return new FakeSocket(u) as unknown as WebSocket
      },
      ['EKS', 'RBAC']
    )
    await Promise.resolve()
    expect(new URL(url).searchParams.getAll('keyterms')).toEqual([
      'EKS',
      'RBAC',
    ])
  })
})

describe('GeminiLiveTranscriber', () => {
  const connect = async () => {
    let socket!: FakeSocket
    const live = new GeminiLiveTranscriber(
      Promise.resolve({ token: 'auth_tokens/gem', terms: ['FinOps'] }),
      (url) => {
        socket = new FakeSocket(url)
        return socket
      }
    )
    await tick()
    return { live, socket }
  }

  it('sends setup with the token terms, holds audio until setup completes, and joins the final pieces', async () => {
    const { live, socket } = await connect()
    vi.useFakeTimers()
    try {
      expect(new URL(socket.url).searchParams.get('access_token')).toBe(
        'auth_tokens/gem'
      )
      socket.open()
      expect(socket.sent[0]).toEqual({
        setup: {
          model: 'models/gemini-3.5-transcribe-live',
          generationConfig: { responseModalities: ['TEXT'] },
          inputAudioTranscription: {
            languageCodes: ['en-US'],
            customVocabulary: ['FinOps'],
          },
        },
      })
      live.push(new Float32Array(1600))
      expect(socket.sent).toHaveLength(1)
      socket.reply({ setupComplete: {} })
      await vi.advanceTimersByTimeAsync(0)
      expect(socket.sent[1]).toMatchObject({
        realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000' } },
      })
      socket.reply({
        serverContent: { inputTranscription: { text: 'For FinOps' } },
      })
      await vi.advanceTimersByTimeAsync(0)
      const text = live.finish()
      expect(socket.sent.at(-1)).toEqual({
        realtimeInput: { audioStreamEnd: true },
      })
      socket.reply({
        serverContent: { inputTranscription: { text: 'we use EC2.' } },
      })
      await vi.advanceTimersByTimeAsync(500)
      await expect(text).resolves.toBe('For FinOps we use EC2.')
      expect(live.lastTextAt).toBeGreaterThan(0)
      expect(socket.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects with the server error', async () => {
    const { live, socket } = await connect()
    socket.open()
    const text = live.finish()
    socket.reply({ error: { message: 'quota exceeded' } })
    await expect(text).rejects.toThrow('Gemini live: quota exceeded')
  })

  it('joins pieces with exactly one space', () => {
    expect(joinPieces('a', 'b')).toBe('a b')
    expect(joinPieces('a ', 'b')).toBe('a b')
    expect(joinPieces('', 'b')).toBe('b')
  })
})

describe('GeminiLiveTranscriber diagnosis', () => {
  it('says what came back when no text arrives in time', async () => {
    let socket!: FakeSocket
    const live = new GeminiLiveTranscriber(
      Promise.resolve({ token: 't', terms: [] }),
      (url) => (socket = new FakeSocket(url))
    )
    await tick()
    socket.open()
    socket.reply({ usageMetadata: { totalTokenCount: 1 } })
    await tick()
    await expect(live.finish(10)).rejects.toThrow(
      /took too long \(opened, no setupComplete, 1 messages, last \{"usageMetadata"/
    )
  })
})

describe('GeminiLiveTranscriber partials', () => {
  it('keeps a partial that was never marked final when the next stretch starts', async () => {
    let socket!: FakeSocket
    const live = new GeminiLiveTranscriber(
      Promise.resolve({ token: 't', terms: [] }),
      (url) => (socket = new FakeSocket(url))
    )
    await tick()
    socket.open()
    socket.reply({ setupComplete: {} })
    const say = (msg: object) => socket.reply({ serverContent: msg })
    say({ interimInputTranscription: { text: 'We then' } })
    say({ interimInputTranscription: { text: 'We then can use AWS S3,' } })
    say({ interimInputTranscription: { text: 'which is' } })
    say({ inputTranscription: { text: 'which is a really good service.' } })
    await tick()
    const text = live.finish(10)
    await expect(text).resolves.toBe(
      'We then can use AWS S3, which is a really good service.'
    )
  })

  it('tells a growing partial from the next stretch', () => {
    expect(sameStretch('We then', 'we then can use')).toBe(true)
    expect(sameStretch('We then can use', 'which is')).toBe(false)
    expect(sameStretch('', 'anything')).toBe(true)
  })
})
