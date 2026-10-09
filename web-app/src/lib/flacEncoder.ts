/**
 * Minimal lossless FLAC encoder for 16-bit mono speech clips. Each block uses
 * the best of FLAC's fixed predictors (orders 0-4) with Rice-coded residuals,
 * which typically halves the size of the same audio as WAV.
 */

const BLOCK_SIZE = 4096
const MAX_PARTITION_ORDER = 6
const MAX_RICE_PARAM = 14 // 15 is the escape code

class BitWriter {
  private buf: Uint8Array<ArrayBuffer> = new Uint8Array(1 << 16)
  private bytes = 0
  private acc = 0 // pending bits, at most 7 between writes
  private accBits = 0

  get byteLength() {
    return this.bytes
  }

  private ensure(extra: number) {
    if (this.bytes + extra <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.bytes + extra) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.bytes))
    this.buf = next
  }

  /** Writes the low `n` bits of `value` (n <= 24), most significant first. */
  write(value: number, n: number) {
    if (n === 0) return
    this.ensure(4)
    this.acc = (this.acc << n) | (value & ((1 << n) - 1))
    this.accBits += n
    while (this.accBits >= 8) {
      this.accBits -= 8
      this.buf[this.bytes++] = (this.acc >>> this.accBits) & 0xff
    }
    this.acc &= (1 << this.accBits) - 1
  }

  /** Writes up to 32 bits. */
  writeLong(value: number, n: number) {
    if (n > 24) {
      this.write(Math.floor(value / 2 ** 24), n - 24)
      this.write(value % 2 ** 24, 24)
    } else {
      this.write(value, n)
    }
  }

  /** `q` zeros followed by a one. */
  unary(q: number) {
    while (q >= 24) {
      this.write(0, 24)
      q -= 24
    }
    this.write(1, q + 1)
  }

  alignToByte() {
    if (this.accBits) this.write(0, 8 - this.accBits)
  }

  slice(from: number, to = this.bytes) {
    return this.buf.subarray(from, to)
  }

  result() {
    return this.buf.slice(0, this.bytes)
  }
}

function crc8(data: Uint8Array) {
  let crc = 0
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++)
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff
  }
  return crc
}

function crc16(data: Uint8Array) {
  let crc = 0
  for (const byte of data) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

/** FLAC's UTF-8-style variable-length frame number. */
function writeFrameNumber(w: BitWriter, n: number) {
  if (n < 0x80) {
    w.write(n, 8)
    return
  }
  let extra = 1 // continuation bytes, 6 payload bits each
  while (n >= 2 ** (6 * extra + 6 - extra)) extra++
  const lead = (0xff << (7 - extra)) & 0xff
  w.write(lead | Math.floor(n / 2 ** (6 * extra)), 8)
  for (let i = extra - 1; i >= 0; i--) {
    w.write(0x80 | (Math.floor(n / 2 ** (6 * i)) & 0x3f), 8)
  }
}

function residuals(block: Int32Array, order: number): Int32Array {
  const out = new Int32Array(block.length - order)
  for (let i = order; i < block.length; i++) {
    let r: number
    switch (order) {
      case 0:
        r = block[i]
        break
      case 1:
        r = block[i] - block[i - 1]
        break
      case 2:
        r = block[i] - 2 * block[i - 1] + block[i - 2]
        break
      case 3:
        r = block[i] - 3 * block[i - 1] + 3 * block[i - 2] - block[i - 3]
        break
      default:
        r =
          block[i] -
          4 * block[i - 1] +
          6 * block[i - 2] -
          4 * block[i - 3] +
          block[i - 4]
    }
    out[i - order] = r
  }
  return out
}

const zigzag = (r: number) => (r >= 0 ? 2 * r : -2 * r - 1)

/** Best Rice parameter and its cost in bits for `u[from..to)`. */
function bestRice(u: Uint32Array, from: number, to: number) {
  const n = to - from
  let sum = 0
  for (let i = from; i < to; i++) sum += u[i]
  // The optimum is within one of log2(mean); check those exactly.
  const guess = n && sum > n ? Math.floor(Math.log2(sum / n)) : 0
  let best = { param: 0, bits: Infinity }
  for (
    let k = Math.max(0, guess - 1);
    k <= Math.min(MAX_RICE_PARAM, guess + 1);
    k++
  ) {
    let bits = 4 + n * (1 + k)
    for (let i = from; i < to; i++) bits += Math.floor(u[i] / 2 ** k)
    if (bits < best.bits) best = { param: k, bits }
  }
  return best
}

type Plan = {
  order: number
  partitionOrder: number
  params: number[]
  bits: number
  u: Uint32Array
}

function planSubframe(block: Int32Array): Plan {
  let best: Plan | null = null
  const maxOrder = Math.min(4, block.length - 1)
  for (let order = 0; order <= maxOrder; order++) {
    const res = residuals(block, order)
    const u = new Uint32Array(res.length)
    for (let i = 0; i < res.length; i++) u[i] = zigzag(res[i])
    for (let p = 0; p <= MAX_PARTITION_ORDER; p++) {
      const parts = 1 << p
      if (block.length % parts) break
      const size = block.length / parts
      if (size <= order) break
      const params: number[] = []
      let bits = 8 + order * 16 + 2 + 4 // header, warm-up, method, partition order
      let start = 0
      for (let part = 0; part < parts; part++) {
        const end = (part + 1) * size - order
        const { param, bits: b } = bestRice(u, start, end)
        params.push(param)
        bits += b
        start = end
      }
      if (!best || bits < best.bits)
        best = { order, partitionOrder: p, params, bits, u }
    }
  }
  return best!
}

function writeFrame(
  w: BitWriter,
  block: Int32Array,
  frameNumber: number,
  sampleRateCode: number
) {
  const start = w.byteLength
  w.write(0b11111111111110, 14) // sync
  w.write(0, 1) // reserved
  w.write(0, 1) // fixed block size
  w.write(0b0111, 4) // block size: 16-bit (n - 1) follows
  w.write(sampleRateCode, 4)
  w.write(0b0000, 4) // mono
  w.write(0b100, 3) // 16 bits per sample
  w.write(0, 1) // reserved
  writeFrameNumber(w, frameNumber)
  w.write(block.length - 1, 16)
  w.write(crc8(w.slice(start)), 8)

  const plan = planSubframe(block)
  const verbatimBits = 8 + block.length * 16
  if (verbatimBits < plan.bits) {
    w.write(0b00000010, 8) // verbatim
    for (const s of block) w.write(s, 16)
  } else {
    w.write(0, 1)
    w.write(0b001000 | plan.order, 6) // fixed predictor
    w.write(0, 1) // no wasted bits
    for (let i = 0; i < plan.order; i++) w.write(block[i], 16)
    w.write(0b00, 2) // Rice coding, 4-bit parameters
    w.write(plan.partitionOrder, 4)
    const parts = 1 << plan.partitionOrder
    const size = block.length / parts
    let i = 0
    for (let part = 0; part < parts; part++) {
      const k = plan.params[part]
      w.write(k, 4)
      const end = (part + 1) * size - plan.order
      for (; i < end; i++) {
        const u = plan.u[i]
        w.unary(Math.floor(u / 2 ** k))
        w.write(u % 2 ** k, k)
      }
    }
  }
  w.alignToByte()
  w.write(crc16(w.slice(start)), 16)
}

const SAMPLE_RATE_CODES: Record<number, number> = {
  8000: 0b0100,
  16000: 0b0101,
  22050: 0b0110,
  24000: 0b0111,
  32000: 0b1000,
  44100: 0b1001,
  48000: 0b1010,
}

/** Encodes mono samples in [-1, 1] as 16-bit FLAC, losslessly for 16-bit audio. */
export function encodeFlacBytes(
  samples: Float32Array,
  sampleRate: number
): Uint8Array<ArrayBuffer> {
  const pcm = new Int32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    // Scale to 16-bit and truncate toward zero.
    pcm[i] = Math.trunc(s < 0 ? s * 0x8000 : s * 0x7fff)
  }

  const w = new BitWriter()
  w.write(0x664c, 16) // "fL"
  w.write(0x6143, 16) // "aC"
  // STREAMINFO, the only (so last) metadata block
  w.write(0x80, 8)
  w.write(34, 24)
  const blockSize = Math.max(16, Math.min(BLOCK_SIZE, pcm.length || 16))
  w.write(blockSize, 16) // min block size
  w.write(blockSize, 16) // max block size
  w.write(0, 24) // min frame size unknown
  w.write(0, 24) // max frame size unknown
  w.write(sampleRate, 20)
  w.write(0, 3) // channels - 1
  w.write(15, 5) // bits per sample - 1
  w.write(Math.floor(pcm.length / 2 ** 32), 4)
  w.writeLong(pcm.length % 2 ** 32, 32)
  for (let i = 0; i < 16; i++) w.write(0, 8) // MD5 not computed

  const rateCode = SAMPLE_RATE_CODES[sampleRate] ?? 0b0000 // 0: see STREAMINFO
  let frame = 0
  for (let off = 0; off < pcm.length; off += BLOCK_SIZE) {
    writeFrame(
      w,
      pcm.subarray(off, Math.min(off + BLOCK_SIZE, pcm.length)),
      frame++,
      rateCode
    )
  }
  return w.result()
}

export function encodeFlac(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeFlacBytes(samples, sampleRate)], {
    type: 'audio/flac',
  })
}
