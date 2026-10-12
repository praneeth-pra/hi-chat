import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { useRef } from 'react'
import type { ThreadMessage } from '@janhq/core'
import { useMessages } from '@/hooks/useMessages'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { THREAD_SCROLL_BEHAVIOR } from '@/constants/threadScroll'
import { ThreadPadding } from '@/containers/ThreadPadding'
import { useAppState } from '@/hooks/useAppState'
import {
  ThreadScrollProvider,
  useThreadScrollState,
} from '@/containers/ThreadScrollProvider'

const THREAD_ID = 'thread-1'
const VIEWPORT_HEIGHT = 600
const MESSAGE_HEIGHT = 100

const message = (id: string, role: 'user' | 'assistant') =>
  ({ id, role, thread_id: THREAD_ID, content: [] }) as unknown as ThreadMessage

function ScrollControl() {
  const { scrollToBottom } = useThreadScrollState()
  return <button onClick={() => scrollToBottom()}>Scroll</button>
}

// A thread view laid out the way the real one is: messages, then the padding.
function Thread() {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messages = useMessages((state) => state.messages[THREAD_ID] ?? [])
  return (
    <ThreadScrollProvider
      threadId={THREAD_ID}
      scrollContainerRef={scrollContainerRef}
    >
      <div ref={scrollContainerRef} data-testid="scroll-container">
        {messages.map((item) => (
          <div key={item.id} data-message-author-role={item.role} />
        ))}
        <ThreadPadding />
        <ScrollControl />
      </div>
    </ThreadScrollProvider>
  )
}

/** jsdom has no layout, so give every message a fixed height. */
function mockLayout(container: HTMLElement) {
  const padding = () =>
    parseFloat(
      (container.querySelector('[data-testid="chat-padding"]') as HTMLElement)
        .style.height || '0'
    )
  const messages = () =>
    Array.from(container.querySelectorAll('[data-message-author-role]'))
  const scrollHeight = () => messages().length * MESSAGE_HEIGHT + padding()
  let scrollTop = 0

  Object.defineProperties(container, {
    clientHeight: { configurable: true, get: () => VIEWPORT_HEIGHT },
    scrollHeight: { configurable: true, get: scrollHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value
      },
    },
  })
  container.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    const maxTop = Math.max(0, scrollHeight() - VIEWPORT_HEIGHT)
    scrollTop = Math.min(options.top ?? 0, maxTop)
  })
  container.scrollTo = scrollTo as unknown as typeof container.scrollTo

  const offsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetHeight'
  )
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return MESSAGE_HEIGHT
    },
  })
  const getRect = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this === container) return { top: 0 } as DOMRect
    const index = messages().indexOf(this)
    return { top: index * MESSAGE_HEIGHT - scrollTop } as DOMRect
  }

  return {
    scrollTo,
    getScrollTop: () => scrollTop,
    restore: () => {
      if (offsetHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          'offsetHeight',
          offsetHeight
        )
      }
      HTMLElement.prototype.getBoundingClientRect = getRect
    },
  }
}

describe('useThreadScrolling (flow)', () => {
  let frames: FrameRequestCallback[]
  let restoreLayout: () => void

  beforeEach(() => {
    frames = []
    // jsdom has no Element.scrollTo; mockLayout gives the container its own.
    HTMLElement.prototype.scrollTo = vi.fn()
    useInterfaceSettings.setState({
      threadScrollBehavior: THREAD_SCROLL_BEHAVIOR.FLOW,
    })
    const history = Array.from({ length: 10 }, (_, i) =>
      message(`m${i}`, i % 2 === 0 ? 'user' : 'assistant')
    )
    useMessages.setState({ messages: { [THREAD_ID]: history } })
  })

  afterEach(() => {
    restoreLayout?.()
    vi.unstubAllGlobals()
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo
  })

  it('puts a new question at the top even when the frame fires before the padding is rendered', () => {
    const { getByTestId } = render(<Thread />)
    const layout = mockLayout(getByTestId('scroll-container'))
    restoreLayout = layout.restore

    // The first frame comes before React has put the padding in the DOM
    // (it is set from an effect); later frames come after.
    let first = true
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      if (first) {
        first = false
        cb(0)
      } else {
        frames.push(cb)
      }
      return 0
    })

    act(() => {
      const current = useMessages.getState().messages[THREAD_ID]
      useMessages.setState({
        messages: { [THREAD_ID]: [...current, message('question', 'user')] },
      })
    })
    act(() => {
      while (frames.length) frames.shift()!(0)
    })

    // The question is the 11th message, so its top is at 1000px. Before the
    // fix this ended at 500: the bottom of the thread without the padding,
    // with the question at the bottom of the viewport.
    const questionTop = 10 * MESSAGE_HEIGHT
    const scrollTop = layout.getScrollTop()
    expect(questionTop - scrollTop).toBeGreaterThanOrEqual(0)
    expect(questionTop - scrollTop).toBeLessThanOrEqual(40)
    expect(layout.scrollTo).toHaveBeenLastCalledWith({
      top: scrollTop,
      behavior: 'smooth',
    })
  })

  it('does not scroll for a new assistant message', () => {
    const { getByTestId } = render(<Thread />)
    const layout = mockLayout(getByTestId('scroll-container'))
    restoreLayout = layout.restore
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb)
      return 0
    })
    layout.scrollTo.mockClear()

    act(() => {
      const current = useMessages.getState().messages[THREAD_ID]
      useMessages.setState({
        messages: { [THREAD_ID]: [...current, message('answer', 'assistant')] },
      })
    })
    act(() => {
      while (frames.length) frames.shift()!(0)
    })

    expect(layout.scrollTo).not.toHaveBeenCalled()
  })
  it('shares one sticky scroll controller and keeps its listener stable while tokens arrive', () => {
    useInterfaceSettings.setState({
      threadScrollBehavior: THREAD_SCROLL_BEHAVIOR.STICKY,
    })
    useAppState.setState({ streamingContent: message('live', 'assistant') })
    const { getByTestId, unmount } = render(<Thread />)
    const container = getByTestId('scroll-container')
    const layout = mockLayout(container)
    restoreLayout = layout.restore
    const add = vi.spyOn(container, 'addEventListener')
    const remove = vi.spyOn(container, 'removeEventListener')
    layout.scrollTo.mockClear()
    act(() =>
      useAppState.setState({
        streamingContent: {
          ...message('live', 'assistant'),
          content: [
            { type: 'text', text: { value: 'Next words', annotations: [] } },
          ] as any,
        },
      })
    )
    expect(layout.scrollTo).toHaveBeenCalledTimes(1)
    expect(add).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    unmount()
    useAppState.setState({ streamingContent: undefined })
  })
})
