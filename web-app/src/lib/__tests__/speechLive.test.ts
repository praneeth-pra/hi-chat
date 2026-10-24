import { describe, it, expect, vi } from 'vitest'
import {
  GrokLiveTranscriber,
  LiveTranscriber,
  MuseLiveTranscriber,
  SarvamLiveTranscriber,
  LIVE_URL,
  CartesiaLiveTranscriber,
  elevenLabsTerms,
  cartesiaTerms,
  SONIOX_LIVE_URL,
  SonioxLiveTranscriber,
  sonioxTerms,
  toPcm16Base64,
} from '../speechLive'

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

describe('speechLive', () => {
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

  it('previews live speech including earlier committed pieces, without finalizing it', async () => {
    let socket!: FakeSocket
    const live = new LiveTranscriber(Promise.resolve('t'), (url) => {
      socket = new FakeSocket(url)
      return socket as unknown as WebSocket
    })
    const preview = vi.fn()
    live.setPreviewListener(preview)
    await tick()
    socket.open()
    socket.reply({
      message_type: 'partial_transcript',
      text: 'Suppose payment',
    })
    expect(preview).toHaveBeenLastCalledWith('Suppose payment')
    socket.reply({
      message_type: 'committed_transcript',
      text: 'Suppose payment succeeds.',
    })
    socket.reply({
      message_type: 'partial_transcript',
      text: 'How do we recover?',
    })
    expect(preview).toHaveBeenLastCalledWith(
      'Suppose payment succeeds. How do we recover?'
    )
    const final = live.finish()
    socket.reply({
      message_type: 'committed_transcript',
      text: 'How do we recover?',
    })
    await expect(final).resolves.toBe(
      'Suppose payment succeeds. How do we recover?'
    )
  })
  it.each(['soniox', 'cartesia'] as const)(
    'previews %s replacement partials without duplicating words',
    async (engine) => {
      let socket!: FakeSocket
      const makeSocket = (url: string) => {
        socket = new FakeSocket(url)
        return socket as unknown as WebSocket
      }
      const key = Promise.resolve({ token: 't', terms: [] })
      const live =
        engine === 'soniox'
          ? new SonioxLiveTranscriber(key, makeSocket)
          : new CartesiaLiveTranscriber(key, makeSocket)
      const preview = vi.fn()
      live.setPreviewListener(preview)
      await tick()
      socket.open()
      if (engine === 'soniox') {
        socket.reply({
          tokens: [
            { text: 'Suppose ', is_final: true },
            { text: 'payment', is_final: false },
          ],
        })
        socket.reply({
          tokens: [{ text: 'payment succeeds.', is_final: false }],
        })
      } else {
        socket.reply({ type: 'transcript', text: 'Suppose ', is_final: true })
        socket.reply({ type: 'transcript', text: 'payment', is_final: false })
        socket.reply({
          type: 'transcript',
          text: 'payment succeeds.',
          is_final: false,
        })
      }
      expect(preview).toHaveBeenLastCalledWith('Suppose payment succeeds.')
      live.abort()
    }
  )
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

  it('returns the segments it already has when the last one is late', async () => {
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
    vi.useFakeTimers()
    try {
      const text = live.finish(1000)
      vi.advanceTimersByTime(1000)
      await expect(text).resolves.toBe('If the route table points')
      expect(socket.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('MuseLiveTranscriber', () => {
  class MuseSocket extends FakeSocket {
    raw: (ArrayBuffer | string)[] = []
    send(data: string) {
      this.raw.push(data)
    }
  }
  const connect = async (keyterms: string[] = []) => {
    let socket!: MuseSocket
    const live = new MuseLiveTranscriber(
      Promise.resolve('abc123'),
      (url) => {
        socket = new MuseSocket(url)
        return socket as unknown as WebSocket
      },
      'https://chat.example',
      keyterms
    )
    await tick()
    return { live, socket }
  }

  it('streams through the relay with a ticket and key terms, then ends the stream', async () => {
    const previews: string[] = []
    const { live, socket } = await connect(['NAT gateway', 'VPC'])
    live.setPreviewListener((t) => previews.push(t))
    expect(socket.url).toBe(
      'wss://chat.example/api/muse-live?ticket=abc123&keyterm=NAT+gateway&keyterm=VPC'
    )
    live.push(new Float32Array(1600))
    socket.open()
    expect((socket.raw[0] as ArrayBuffer).byteLength).toBe(3200)
    socket.reply({ type: 'ready' })
    socket.reply({ type: 'transcript', transcript: 'What is a', final: false })
    socket.reply({
      type: 'transcript',
      transcript: 'What is a NAT gateway',
      final: false,
    })
    const text = live.finish()
    expect(socket.raw.at(-1)).toBe(JSON.stringify({ type: 'endStream' }))
    socket.reply({
      type: 'transcript',
      transcript: 'What is a NAT gateway?',
      final: true,
    })
    await expect(text).resolves.toBe('What is a NAT gateway?')
    expect(previews).toEqual([
      'What is a',
      'What is a NAT gateway',
      'What is a NAT gateway?',
    ])
    expect(socket.closed).toBe(true)
  })

  it('keeps the last partial if the socket closes before the final', async () => {
    const { live, socket } = await connect()
    socket.open()
    socket.reply({
      type: 'transcript',
      transcript: 'Explain EKS',
      final: false,
    })
    const text = live.finish()
    socket.onclose?.(new CloseEvent('close'))
    await expect(text).resolves.toBe('Explain EKS')
  })

  it('fails on an error message', async () => {
    const { live, socket } = await connect()
    socket.open()
    const text = live.finish()
    socket.reply({ type: 'error', message: 'invalid key' })
    await expect(text).rejects.toThrow('Muse live: invalid key')
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

  it('sends the config with the key terms first, then audio, and joins the final words', async () => {
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
      context: { terms: ['VPC', 'kubectl', 'S3 bucket'] },
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
    const many = Array.from({ length: 2000 }, (_, i) => `Term ${i}`)
    const out = sonioxTerms(many)
    expect(out.join(', ').length).toBeLessThanOrEqual(1500)
    expect(out[0]).toBe('Term 0')
  })

  it('sends key terms, then technical terms, then everyday words', () => {
    const out = sonioxTerms(
      ['JMeter', 'filter'],
      ['filter', 'select', 'Kafka', 'star schema', 'boto3', 'jmeter']
    )
    expect(out).toEqual([
      'JMeter',
      'filter',
      'Kafka',
      'boto3',
      'select',
      'star schema',
    ])
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

describe('SarvamLiveTranscriber', () => {
  class SarvamSocket extends FakeSocket {
    raw: (ArrayBuffer | string)[] = []
    send(data: string) {
      this.raw.push(data)
    }
  }
  const connect = async (keyterms: string[] = []) => {
    let socket!: SarvamSocket
    const live = new SarvamLiveTranscriber(
      Promise.resolve('abc123'),
      (url) => {
        socket = new SarvamSocket(url)
        return socket as unknown as WebSocket
      },
      'https://chat.example',
      keyterms
    )
    await tick()
    return { live, socket }
  }

  it('streams through the relay, joins each stretch of speech, and flushes at the end', async () => {
    const previews: string[] = []
    const { live, socket } = await connect(['Koramangala'])
    live.setPreviewListener((t) => previews.push(t))
    expect(socket.url).toBe(
      'wss://chat.example/api/sarvam-live?ticket=abc123&keyterm=Koramangala'
    )
    live.push(new Float32Array(1600))
    socket.open()
    expect((socket.raw[0] as ArrayBuffer).byteLength).toBe(3200)
    socket.reply({ type: 'ready' })
    socket.reply({ type: 'events', data: { signal_type: 'START_SPEECH' } })
    socket.reply({ type: 'data', data: { transcript: 'I stay in Koramangala.' } })
    socket.reply({ type: 'events', data: { signal_type: 'START_SPEECH' } })
    const text = live.finish()
    expect(socket.raw.at(-1)).toBe(JSON.stringify({ type: 'flush' }))
    socket.reply({ type: 'data', data: { transcript: 'Near Ejipura.' } })
    await expect(text).resolves.toBe('I stay in Koramangala. Near Ejipura.')
    expect(previews).toEqual([
      'I stay in Koramangala.',
      'I stay in Koramangala. Near Ejipura.',
    ])
    expect(socket.closed).toBe(true)
  })

  it('finishes at once when everything heard is already written out', async () => {
    const { live, socket } = await connect()
    socket.open()
    socket.reply({ type: 'events', data: { signal_type: 'START_SPEECH' } })
    socket.reply({ type: 'data', data: { transcript: 'What is EKS?' } })
    const started = Date.now()
    await expect(live.finish()).resolves.toBe('What is EKS?')
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('fails on an error message', async () => {
    const { live, socket } = await connect()
    socket.open()
    const text = live.finish()
    socket.reply({ type: 'error', data: { error: 'invalid key' } })
    await expect(text).rejects.toThrow('Sarvam live: invalid key')
  })
})
