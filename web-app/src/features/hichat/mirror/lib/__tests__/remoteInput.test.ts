import { describe, expect, it } from 'vitest'
import {
  MOD,
  createClickCounter,
  keyAction,
  macMods,
  screenPoint,
  wheelPixels,
} from '../remoteInput'

const mods = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }

describe('remote control', () => {
  it('finds the point on the shared screen, past the bars around it', () => {
    // A 16:9 picture in a square box: bars above and below
    const box = { left: 100, top: 0, width: 1000, height: 1000 }
    expect(screenPoint(600, 500, box, 1920, 1080)).toEqual({ x: 0.5, y: 0.5 })
    expect(screenPoint(100, 218.75, box, 1920, 1080)).toEqual({ x: 0, y: 0 })
    // In a bar, or before the picture has a size: nothing
    expect(screenPoint(600, 100, box, 1920, 1080)).toBeNull()
    expect(screenPoint(600, 500, box, 0, 0)).toBeNull()
  })

  it("maps a Windows keyboard's Ctrl to the Mac's Command", () => {
    expect(macMods({ ...mods, ctrlKey: true }, false)).toBe(MOD.cmd)
    expect(macMods({ ...mods, metaKey: true }, false)).toBe(MOD.control)
    expect(macMods({ ...mods, ctrlKey: true }, true)).toBe(MOD.control)
    expect(macMods({ ...mods, metaKey: true, shiftKey: true }, true)).toBe(
      MOD.cmd | MOD.shift
    )
    expect(macMods({ ...mods, altKey: true }, false)).toBe(MOD.option)
  })

  it('sends keys by position, with their modifiers', () => {
    // Ctrl+C on Windows is Command+C (copy) on the Mac
    expect(
      keyAction(
        { ...mods, ctrlKey: true, code: 'KeyC', repeat: false },
        true,
        false
      )
    ).toEqual({ k: 'kd', c: 8, m: MOD.cmd })
    expect(
      keyAction({ ...mods, code: 'Enter', repeat: true }, true, false)
    ).toEqual({ k: 'kd', c: 36, m: 0, r: 1 })
    expect(
      keyAction({ ...mods, code: 'ArrowLeft', repeat: false }, false, true)
    ).toEqual({ k: 'ku', c: 123, m: 0 })
    // Modifiers alone, and keys with no Mac twin, aren't sent
    expect(
      keyAction(
        { ...mods, ctrlKey: true, code: 'ControlLeft', repeat: false },
        true,
        false
      )
    ).toBeNull()
    expect(
      keyAction({ ...mods, code: 'LaunchMail', repeat: false }, true, false)
    ).toBeNull()
  })

  it('measures the wheel in pixels', () => {
    expect(wheelPixels({ deltaX: 0, deltaY: 120, deltaMode: 0 })).toEqual({
      dx: 0,
      dy: 120,
    })
    expect(wheelPixels({ deltaX: 1, deltaY: 3, deltaMode: 1 })).toEqual({
      dx: 16,
      dy: 48,
    })
  })

  it('counts double and triple clicks in one place', () => {
    let t = 0
    const count = createClickCounter(() => t)
    expect(count(0, 0.5, 0.5)).toBe(1)
    t = 200
    expect(count(0, 0.5, 0.5)).toBe(2)
    t = 400
    expect(count(0, 0.501, 0.5)).toBe(3)
    // Too slow, elsewhere, or another button: a new click
    t = 2000
    expect(count(0, 0.5, 0.5)).toBe(1)
    t = 2100
    expect(count(0, 0.7, 0.5)).toBe(1)
    t = 2200
    expect(count(1, 0.7, 0.5)).toBe(1)
  })
})
