// The call's sound, from the computer itself: the Hi-chat app records what
// the computer's speakers play (lib/computerAudio.ts) and sends it straight
// to each /mirror viewer on a data channel of the direct connection
// (lib/mirrorDirect.ts), where it is played. It works whatever the call runs
// in (Meet, Teams, Zoom, their desktop apps), as nothing looks inside the
// call's page for it; the camera extension has no part in the sound.
//
// The computer's sound also holds the /mirror viewer's own voice, which the
// extension plays there for the people at that computer. So while the
// viewer talks (and for a moment after, as the voice takes that long to
// come back), the sound is turned down for them.

/** Whether the viewer muted the call's sound (remembered). */
export const CALL_MUTED = 'hichat-mirror-call-muted'

/** The rate the sound travels at: plenty for voices, half the data of 48 kHz. */
export const SOUND_RATE = 24000
const HEADER = 8
/** A block quieter than this throughout is silence, and isn't sent. */
const SILENCE = 1e-4
/** While silent, a packet without sound this often says "still here". */
export const KEEPALIVE_MS = 1000

/**
 * Packs the app's blocks for the data channel: a sequence number and the
 * rate, then the samples as 16-bit, at SOUND_RATE where the app's rate is a
 * multiple of it. Silence is a header alone, once a second.
 */
export function createSoundPacker(now: () => number = Date.now) {
  let seq = 0
  let lastSent = -Infinity
  return (block: Float32Array, rate: number): ArrayBuffer | null => {
    const step = Math.max(1, Math.round(rate / SOUND_RATE))
    let loud = false
    for (let i = 0; i < block.length; i++)
      if (Math.abs(block[i]) > SILENCE) {
        loud = true
        break
      }
    if (!loud && now() - lastSent < KEEPALIVE_MS) return null
    lastSent = now()
    const n = loud ? Math.floor(block.length / step) : 0
    const out = new DataView(new ArrayBuffer(HEADER + n * 2))
    out.setUint32(0, ++seq, true)
    out.setUint32(4, Math.round(rate / step), true)
    for (let i = 0; i < n; i++) {
      // The mean of each group: a plain low-pass before dropping samples
      let sum = 0
      for (let k = 0; k < step; k++) sum += block[i * step + k]
      const v = Math.max(-1, Math.min(1, sum / step))
      out.setInt16(HEADER + i * 2, Math.round(v * 32767), true)
    }
    return out.buffer
  }
}

/** A packet's number, rate and samples; null when it isn't one. */
export function unpackSound(
  data: unknown
): { seq: number; rate: number; samples: Float32Array } | null {
  if (!(data instanceof ArrayBuffer) || data.byteLength < HEADER) return null
  const view = new DataView(data)
  const rate = view.getUint32(4, true)
  if (rate < 8000 || rate > 96000) return null
  const n = (data.byteLength - HEADER) >> 1
  const samples = new Float32Array(n)
  for (let i = 0; i < n; i++)
    samples[i] = view.getInt16(HEADER + i * 2, true) / 32768
  return { seq: view.getUint32(0, true), rate, samples }
}

/** The app's sound counts as arriving for this long after its last packet. */
const ALIVE_MS = 2500
/** Played this far behind arrival, to ride out uneven delivery. */
const BUFFER_S = 0.1
/** Further behind than this, the backlog is dropped to catch up. */
const MAX_BEHIND_S = 0.6
/** How much of the sound is left while the viewer talks. */
const DUCKED = 0.05
/** The viewer's voice takes up to this long to come back from the call. */
export const TALK_HOLD_MS = 900
const LOUD = 0.004
const TALKING = 0.02
const TICK_MS = 50
/** The sound counts as heard lately for this long after its last sound. */
const LOUD_HOLD_MS = 6000

const level = (analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>) => {
  analyser.getFloatTimeDomainData(buf)
  let sum = 0
  for (const v of buf) sum += v * v
  return Math.sqrt(sum / buf.length)
}

/**
 * Plays the app's sound on /mirror, turned down while the viewer talks.
 * `onState` says whether the sound is arriving, and whether it has been
 * anything but silence lately.
 */
export function createCallSoundPlayer({
  onState,
  onBlocked,
  AudioContextImpl = globalThis.AudioContext,
}: {
  onState: (state: { arriving: boolean; loud: boolean }) => void
  /** The browser wants a click before any sound plays */
  onBlocked: () => void
  AudioContextImpl?: typeof AudioContext
}) {
  const ctx = new AudioContextImpl()
  const out = ctx.createGain()
  out.connect(ctx.destination)
  const appMeter = ctx.createAnalyser()
  const micMeter = ctx.createAnalyser()
  const buf = new Float32Array(appMeter.fftSize)
  let lastSeq = 0
  let lastPacket = -Infinity
  let lastLoud = -Infinity
  let playAt = 0
  let muted = false
  let state = { arriving: false, loud: false }
  let talkingUntil = -Infinity
  let micNode: MediaStreamAudioSourceNode | null = null
  let blockedTold = false
  let lastResume = -Infinity

  const setGain = (talking: boolean) => {
    const to = muted ? 0 : talking ? DUCKED : 1
    out.gain.setTargetAtTime(
      to,
      ctx.currentTime,
      to < out.gain.value ? 0.015 : 0.08
    )
  }

  const tick = setInterval(() => {
    const now = performance.now()
    const arriving = now - lastPacket < ALIVE_MS
    if (ctx.state === 'running') {
      blockedTold = false
      if (micNode && level(micMeter, buf) > TALKING)
        talkingUntil = now + TALK_HOLD_MS
      if (level(appMeter, buf) > LOUD) lastLoud = now
      setGain(now < talkingUntil)
    } else {
      if (now - lastResume > 1000) {
        lastResume = now
        ctx.resume().catch(() => {})
      }
      // The sound is here but the browser holds it back until a click
      if (arriving && !blockedTold) {
        blockedTold = true
        onBlocked()
      }
    }
    const loud = now - lastLoud < LOUD_HOLD_MS
    if (arriving !== state.arriving || loud !== state.loud)
      onState((state = { arriving, loud }))
  }, TICK_MS)

  return {
    /** A packet from the app's sound channel. */
    push(data: unknown) {
      const p = unpackSound(data)
      if (!p) return
      // Out of order or twice: late is useless. A much lower number is the
      // app starting again
      if (p.seq <= lastSeq && lastSeq - p.seq < 500) return
      lastSeq = p.seq
      lastPacket = performance.now()
      if (!p.samples.length || ctx.state !== 'running') return
      const audio = ctx.createBuffer(1, p.samples.length, p.rate)
      audio.copyToChannel(p.samples as Float32Array<ArrayBuffer>, 0)
      const node = ctx.createBufferSource()
      node.buffer = audio
      node.connect(appMeter)
      node.connect(out)
      const now = ctx.currentTime
      if (playAt < now + 0.01 || playAt > now + MAX_BEHIND_S)
        playAt = now + BUFFER_S
      node.start(playAt)
      playAt += audio.duration
    },
    /** This computer's mic, to hear when its user talks; null when not sent. */
    setMic(stream: MediaStream | null) {
      micNode?.disconnect()
      micNode = null
      talkingUntil = -Infinity
      const track = stream?.getAudioTracks()[0]
      if (!track) return
      micNode = ctx.createMediaStreamSource(new MediaStream([track]))
      micNode.connect(micMeter)
    },
    setMuted(on: boolean) {
      muted = on
      setGain(performance.now() < talkingUntil)
    },
    /** After a click: start the sound the browser was holding back. */
    resume() {
      blockedTold = false
      return ctx.resume().catch(() => {})
    },
    close() {
      clearInterval(tick)
      micNode?.disconnect()
      ctx.close().catch(() => {})
    },
  }
}
