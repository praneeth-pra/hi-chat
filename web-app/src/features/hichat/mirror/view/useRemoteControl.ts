import { useEffect, useRef, type RefObject } from 'react'
import type { RemoteInput } from '@/features/hichat/mirror/lib/mirrorDirect'
import {
  createClickCounter,
  keyAction,
  macMods,
  screenPoint,
  wheelPixels,
} from '@/features/hichat/mirror/lib/remoteInput'

/**
 * While `on`: this page's mouse over the shared screen, its wheel and its
 * keys go to the computer sharing it (lib/remoteInput.ts). Your own pointer
 * moves at once; the picture follows a moment later. Shift+Esc stops.
 */
export function useRemoteControl({
  on,
  video,
  sendInput,
  stop,
}: {
  on: boolean
  video: RefObject<HTMLVideoElement | null>
  sendInput: (m: RemoteInput) => boolean
  stop: () => void
}) {
  const stopRef = useRef(stop)
  stopRef.current = stop
  useEffect(() => {
    const el = video.current
    if (!on || !el) return
    const viewerIsMac = /Mac/.test(navigator.platform || navigator.userAgent)
    const clicks = createClickCounter()
    const held = new Set<number>()
    const at = (e: { clientX: number; clientY: number }) =>
      screenPoint(
        e.clientX,
        e.clientY,
        el.getBoundingClientRect(),
        el.videoWidth,
        el.videoHeight
      )
    const aspect = () =>
      el.videoHeight
        ? Math.round((el.videoWidth / el.videoHeight) * 1000) / 1000
        : 0
    const mouse = (k: string, e: PointerEvent | MouseEvent, extra = {}) => {
      const p = at(e)
      if (!p) return false
      sendInput({ k, ...p, m: macMods(e, viewerIsMac), a: aspect(), ...extra })
      return true
    }
    // Browser button numbers: 0 left, 1 middle, 2 right; the Mac's: 0, 2, 1
    const button = (b: number) => (b === 2 ? 1 : b === 1 ? 2 : 0)
    const onMove = (e: PointerEvent) => {
      mouse('m', e)
    }
    const onDown = (e: PointerEvent) => {
      const p = at(e)
      if (!p) return
      e.preventDefault()
      el.setPointerCapture?.(e.pointerId)
      const b = button(e.button)
      held.add(b)
      mouse('d', e, { b, c: clicks(b, p.x, p.y) })
    }
    const onUp = (e: PointerEvent) => {
      const b = button(e.button)
      if (!held.delete(b)) return
      const p = at(e)
      sendInput({
        k: 'u',
        ...(p ?? {}),
        b,
        m: macMods(e, viewerIsMac),
        a: aspect(),
      })
    }
    const onWheel = (e: WheelEvent) => {
      if (!at(e)) return
      e.preventDefault()
      sendInput({ k: 'w', ...wheelPixels(e), m: macMods(e, viewerIsMac) })
    }
    const noMenu = (e: Event) => e.preventDefault()
    const onKey = (e: KeyboardEvent) => {
      const down = e.type === 'keydown'
      if (down && e.key === 'Escape' && e.shiftKey) {
        e.preventDefault()
        stopRef.current()
        return
      }
      const action = keyAction(e, down, viewerIsMac)
      if (!action) return
      // The keys are the shared computer's now, not this page's
      e.preventDefault()
      e.stopPropagation()
      sendInput(action)
    }
    // Nothing stays held down there when focus leaves here
    const release = () => {
      held.clear()
      sendInput({ k: 'r' })
    }
    const onHidden = () => document.hidden && release()
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('contextmenu', noMenu)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', onHidden)
    // In full screen, Chrome also passes keys like Ctrl+W and Ctrl+T on
    const keyboard = (
      navigator as Navigator & {
        keyboard?: { lock?: () => Promise<void>; unlock?: () => void }
      }
    ).keyboard
    keyboard?.lock?.().catch(() => {})
    return () => {
      release()
      keyboard?.unlock?.()
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('contextmenu', noMenu)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [on, video, sendInput])
}
