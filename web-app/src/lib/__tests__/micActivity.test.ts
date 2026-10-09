import { describe, expect, it } from 'vitest'
import {
  createCallLevel,
  createSpeechDetector,
  ECHO_MS,
  createTurnTracker,
  findMicDevice,
  SPEAKING_MS,
  TURN_MAX_MS,
} from '../micActivity'

const device = (deviceId: string, label: string, kind = 'audioinput') =>
  ({ deviceId, label, kind }) as MediaDeviceInfo

describe('findMicDevice', () => {
  it('picks the default input and never the loopback', () => {
    const devices = [
      device('bh', 'BlackHole 2ch'),
      device('out', 'Speakers', 'audiooutput'),
      device('mac', 'MacBook Pro Microphone'),
      device('default', 'Default - MacBook Pro Microphone'),
    ]
    expect(findMicDevice(devices)?.deviceId).toBe('default')
    expect(findMicDevice(devices.slice(0, 3))?.deviceId).toBe('mac')
    expect(findMicDevice(devices.slice(0, 2))).toBeUndefined()
  })

  it('uses the mic picked in Settings when it is plugged in', () => {
    const devices = [
      device('bh', 'BlackHole 2ch'),
      device('cam', 'Logitech Webcam C920'),
      device('default', 'Default - MacBook Pro Microphone'),
    ]
    expect(findMicDevice(devices, 'Logitech Webcam C920')?.deviceId).toBe('cam')
    expect(findMicDevice(devices, 'Unplugged USB mic')?.deviceId).toBe(
      'default'
    )
    expect(findMicDevice(devices, 'BlackHole 2ch')?.deviceId).toBe('default')
  })
})

describe('createSpeechDetector', () => {
  const frames = (ms: number) => Math.ceil(ms / 50)

  it('counts sustained sound above the noise floor as talking', () => {
    let t = 1000
    const d = createSpeechDetector(() => t)
    for (let i = 0; i < 20; i++) d.push(0.005)
    expect(d.spokeAt()).toBe(0)
    for (let i = 0; i < frames(SPEAKING_MS); i++) {
      t += 50
      d.push(0.2)
    }
    expect(d.spokeAt()).toBe(t)
  })

  it('ignores short bumps and steady room noise', () => {
    const d = createSpeechDetector(() => 5000)
    for (let i = 0; i < 20; i++) d.push(0.003)
    d.push(0.3)
    d.push(0.003)
    expect(d.spokeAt()).toBe(0)
    // A fan: steady, so it never stands out from the floor
    const fan = createSpeechDetector(() => 5000)
    for (let i = 0; i < 400; i++) fan.push(0.02 + (i % 2) * 0.001)
    expect(fan.spokeAt()).toBe(0)
    // Faint sounds stay under the minimum level in a quiet room
    const later = createSpeechDetector(() => 9000)
    for (let i = 0; i < 400; i++) later.push(0.004)
    for (let i = 0; i < 4; i++) later.push(0.009)
    expect(later.spokeAt()).toBe(0)
  })
})

describe('ignoring the interviewer through the speakers', () => {
  it('does not count mic sound while the call is loud', () => {
    let t = 0
    const call = createCallLevel(0.01, () => t)
    const d = createSpeechDetector(() => t, call.talking)
    for (let i = 0; i < 20; i++) d.push(0.003)
    // The interviewer talks: loud on the call and, faintly, in the mic
    for (let i = 0; i < 40; i++) {
      t += 50
      call.push(0.1)
      d.push(0.05)
    }
    expect(d.spokeAt()).toBe(0)
    // They stop; you answer once the echo has died away
    call.push(0.001)
    t += ECHO_MS
    for (let i = 0; i < 20; i++) {
      t += 50
      call.push(0.001)
      d.push(0.2)
    }
    expect(d.spokeAt()).toBe(t)
  })
})

describe('short acknowledgements', () => {
  it('does not count "okay" but counts an answer with pauses between words', () => {
    let t = 0
    const d = createSpeechDetector(() => t)
    const frame = (level: number) => {
      t += 50
      d.push(level)
    }
    for (let i = 0; i < 20; i++) frame(0.003)
    // "Okay" (0.4 s), then silence
    for (let i = 0; i < 8; i++) frame(0.2)
    for (let i = 0; i < 40; i++) frame(0.003)
    expect(d.spokeAt()).toBe(0)
    // An answer: words with short gaps between them
    for (let w = 0; w < 6; w++) {
      for (let i = 0; i < 5; i++) frame(0.2)
      frame(0.003)
    }
    expect(d.spokeAt()).toBeGreaterThan(0)
  })
})

describe('createTurnTracker', () => {
  const setup = (on = true, enabled = true) => {
    let t = 10_000
    const mic = { spoke: 0 }
    const turns = createTurnTracker(
      { spokeAt: () => mic.spoke, on: () => on },
      () => enabled,
      () => t
    )
    return { turns, mic, advance: (ms: number) => (t += ms), now: () => t }
  }

  it('joins passes until you speak', () => {
    const { turns, mic, advance, now } = setup()
    expect(turns.next('How do you secure a VPC?')).toEqual({
      text: 'How do you secure a VPC?',
      continues: false,
    })
    advance(8000)
    expect(turns.next('Specifically for a multi-account setup?')).toEqual({
      text: 'How do you secure a VPC? Specifically for a multi-account setup?',
      continues: true,
    })
    advance(4000)
    mic.spoke = now()
    advance(20_000)
    expect(turns.next('What about logging?').continues).toBe(false)
  })

  it('does not repeat a pass that already holds the last question', () => {
    const { turns, advance } = setup()
    turns.next('How do you secure a VPC?')
    advance(5000)
    expect(
      turns.next('So how do you secure a VPC across many accounts?').text
    ).toBe('So how do you secure a VPC across many accounts?')
  })

  it('starts a new turn after a long answer, a long gap, or without the mic', () => {
    const a = setup()
    a.turns.next('Tell me about Terraform state.')
    a.turns.end()
    expect(a.turns.next('And modules?').continues).toBe(false)

    const b = setup()
    b.turns.next('Tell me about Terraform state.')
    b.advance(TURN_MAX_MS + 1)
    expect(b.turns.next('And modules?').continues).toBe(false)

    const c = setup(false)
    c.turns.next('Tell me about Terraform state.')
    expect(c.turns.next('And modules?').continues).toBe(false)

    const d = setup(true, false)
    d.turns.next('Tell me about Terraform state.')
    expect(d.turns.next('And modules?').continues).toBe(false)
  })

  it('builds on a question the judge already joined', () => {
    const { turns } = setup()
    turns.next('How do you secure a VPC?')
    turns.revised('How do you secure a VPC with many accounts?')
    expect(turns.next('And on-prem?').text).toBe(
      'How do you secure a VPC with many accounts? And on-prem?'
    )
  })
})
