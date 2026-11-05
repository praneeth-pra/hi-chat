import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useRef } from 'react'
import { useKeepScrollPlace } from '../useKeepScrollPlace'

/** Stand-in ResizeObserver: the test says when sizes changed. */
let changed: (els: Element[]) => void = () => {}
class FakeResizeObserver {
  watched = new Set<Element>()
  constructor(private cb: ResizeObserverCallback) {
    changed = (els) =>
      this.cb(
        els
          .filter((e) => this.watched.has(e))
          .map((target) => ({ target }) as ResizeObserverEntry),
        this as unknown as ResizeObserver
      )
  }
  observe(el: Element) {
    this.watched.add(el)
  }
  unobserve(el: Element) {
    this.watched.delete(el)
  }
  disconnect() {
    this.watched.clear()
  }
}

/** Three messages stacked in a 600 px view; heights can be changed. */
const heights = [480, 480, 480]
function Chat() {
  const ref = useRef<HTMLDivElement>(null)
  useKeepScrollPlace(ref)
  return (
    <div ref={ref} data-testid="scroller">
      <div>
        {heights.map((_, i) => (
          <div key={i} data-message-author-role="assistant" data-i={i} />
        ))}
      </div>
    </div>
  )
}

function layout(scroller: HTMLElement) {
  let scrollTop = 0
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v
    },
  })
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
  scroller.querySelectorAll('[data-i]').forEach((el) => {
    const i = Number((el as HTMLElement).dataset.i)
    el.getBoundingClientRect = () => {
      const top = heights.slice(0, i).reduce((a, b) => a + b, 0) - scrollTop
      return { top, height: heights[i], bottom: top + heights[i] } as DOMRect
    }
  })
  return { get: () => scrollTop, set: (v: number) => (scrollTop = v) }
}

describe('useKeepScrollPlace', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    heights.splice(0, 3, 480, 480, 480)
  })

  it('moves the view with a message above it that takes its real height', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const { getByTestId } = render(<Chat />)
    const scroller = getByTestId('scroller')
    const view = layout(scroller)
    const els = Array.from(scroller.querySelectorAll('[data-i]'))
    // jsdom has no layout: let the hook see the mocked 480 px heights first
    act(() => changed(els))
    view.set(1000) // Reading message 2; messages 0 and 1 are above

    // Message 0 is drawn for real: 2000 px instead of 480
    heights[0] = 2000
    act(() => changed([els[0]]))
    expect(view.get()).toBe(1000 + 1520)
  })

  it('leaves the view alone when the message in view grows (streaming)', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const { getByTestId } = render(<Chat />)
    const scroller = getByTestId('scroller')
    const view = layout(scroller)
    const els = Array.from(scroller.querySelectorAll('[data-i]'))
    act(() => changed(els))
    view.set(700) // Message 1 (480-960) is in view

    heights[1] = 900
    act(() => changed([els[1]]))
    expect(view.get()).toBe(700)
    // And one below the view
    heights[2] = 1500
    act(() => changed([els[2]]))
    expect(view.get()).toBe(700)
  })
})
