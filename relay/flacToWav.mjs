// Turns the browser's speaker FLAC (web-app/src/lib/flacEncoder.ts: 16-bit
// mono, fixed-predictor or verbatim subframes, Rice residuals) back into WAV
// for engines that don't take FLAC (AssemblyAI's Sync API). Only that subset
// of FLAC is supported; anything else throws.

class BitReader {
  constructor(bytes) {
    this.bytes = bytes
    this.pos = 0 // in bits
  }

  read(n) {
    let v = 0
    for (let i = 0; i < n; i++) {
      const byte = this.bytes[this.pos >> 3]
      if (byte === undefined) throw new Error('FLAC ended early')
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1)
      this.pos++
    }
    return v
  }

  signed(n) {
    const v = this.read(n)
    return v >= 2 ** (n - 1) ? v - 2 ** n : v
  }

  unary() {
    let q = 0
    while (this.read(1) === 0) q++
    return q
  }

  align() {
    this.pos = (this.pos + 7) & ~7
  }

  get done() {
    return this.pos >= this.bytes.length * 8
  }
}

function skipFrameNumber(r) {
  const first = r.read(8)
  let extra = 0
  while ((first << extra) & 0x80) extra++
  for (let i = 1; i < extra; i++) r.read(8)
}

function predict(out, i, order) {
  switch (order) {
    case 0:
      return 0
    case 1:
      return out[i - 1]
    case 2:
      return 2 * out[i - 1] - out[i - 2]
    case 3:
      return 3 * out[i - 1] - 3 * out[i - 2] + out[i - 3]
    default:
      return 4 * out[i - 1] - 6 * out[i - 2] + 4 * out[i - 3] - out[i - 4]
  }
}

/** Decodes the samples and sample rate of a speaker FLAC. */
export function decodeFlac(bytes) {
  const r = new BitReader(bytes)
  if (r.read(32) !== 0x664c6143) throw new Error('Not FLAC')
  let sampleRate = 0
  let total = 0
  for (let last = 0; !last; ) {
    last = r.read(1)
    const type = r.read(7)
    const length = r.read(24)
    if (type === 0) {
      r.read(32) // block sizes
      r.read(48) // frame sizes
      sampleRate = r.read(20)
      const channels = r.read(3) + 1
      const bits = r.read(5) + 1
      if (channels !== 1 || bits !== 16)
        throw new Error('Only 16-bit mono FLAC is supported')
      total = r.read(36)
      r.read(128) // MD5
    } else {
      r.pos += length * 8
    }
  }
  const samples = new Int16Array(total)
  let written = 0
  while (written < total && !r.done) {
    if (r.read(14) !== 0b11111111111110) throw new Error('Lost FLAC sync')
    r.read(2) // reserved, blocking strategy
    const sizeCode = r.read(4)
    r.read(4) // sample rate code (STREAMINFO has it)
    r.read(4) // channels
    r.read(3) // sample size
    r.read(1)
    skipFrameNumber(r)
    let size
    if (sizeCode === 0b0110) size = r.read(8) + 1
    else if (sizeCode === 0b0111) size = r.read(16) + 1
    else throw new Error('Unsupported FLAC block size')
    r.read(8) // CRC-8
    r.read(1)
    const type = r.read(6)
    if (r.read(1)) throw new Error('Unsupported FLAC wasted bits')
    const block = new Int32Array(size)
    if (type === 0b000001) {
      for (let i = 0; i < size; i++) block[i] = r.signed(16)
    } else if ((type & 0b111000) === 0b001000) {
      const order = type & 0b111
      for (let i = 0; i < order; i++) block[i] = r.signed(16)
      if (r.read(2) !== 0) throw new Error('Unsupported FLAC residual coding')
      const parts = 1 << r.read(4)
      const partSize = size / parts
      let i = order
      for (let part = 0; part < parts; part++) {
        const k = r.read(4)
        if (k === 15) throw new Error('Unsupported FLAC escape code')
        const end = (part + 1) * partSize
        for (; i < end; i++) {
          const u = r.unary() * 2 ** k + r.read(k)
          const res = u % 2 ? -(u + 1) / 2 : u / 2
          block[i] = res + predict(block, i, order)
        }
      }
    } else {
      throw new Error('Unsupported FLAC subframe')
    }
    r.align()
    r.read(16) // CRC-16
    const take = Math.min(size, total - written)
    for (let i = 0; i < take; i++) samples[written++] = block[i]
  }
  return { samples: samples.subarray(0, written), sampleRate }
}

/** 16-bit mono WAV bytes for `samples`. */
export function toWav(samples, sampleRate) {
  const out = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(out.buffer)
  const ascii = (at, s) =>
    [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  ascii(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++)
    v.setInt16(44 + i * 2, samples[i], true)
  return out
}

/** The speaker FLAC as a WAV Blob. */
export async function flacToWav(file) {
  const { samples, sampleRate } = decodeFlac(
    new Uint8Array(await file.arrayBuffer())
  )
  return new Blob([toWav(samples, sampleRate)], { type: 'audio/wav' })
}
