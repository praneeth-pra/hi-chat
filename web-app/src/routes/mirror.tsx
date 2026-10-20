import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { route } from '@/constants/routes'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import {
  applyMirrorMessage,
  emptyMirror,
  mirrorSocketUrl,
  type MirrorState,
} from '@/lib/remoteMirror'
import { cn } from '@/lib/utils'

// The remote mirror's viewer: open /mirror on another signed-in computer to
// follow the conversation open in Hi-chat, live (see lib/remoteMirror.ts).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.mirror as any)({
  component: MirrorViewer,
})

// Reasoning stays out of the mirror, as it's folded away in Hi-chat
const withoutThinking = (text: string) =>
  text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim()

function MirrorViewer() {
  const [state, setState] = useState<MirrorState>(emptyMirror)
  const [connected, setConnected] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)

  useEffect(() => {
    let ws: WebSocket | null = null
    let stopped = false
    let retryMs = 1000
    let retry: ReturnType<typeof setTimeout> | undefined
    const connect = () => {
      const socket = new WebSocket(mirrorSocketUrl(window.location, 'view'))
      ws = socket
      socket.onopen = () => {
        retryMs = 1000
        setConnected(true)
      }
      socket.onmessage = (e) => {
        try {
          const m = JSON.parse(String(e.data))
          setState((s) => applyMirrorMessage(s, m))
        } catch {
          // not a mirror message
        }
      }
      socket.onclose = () => {
        if (ws !== socket) return
        setConnected(false)
        if (stopped) return
        retry = setTimeout(connect, retryMs)
        retryMs = Math.min(retryMs * 2, 15_000)
      }
    }
    connect()
    const ping = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send('{"t":"ping"}')
    }, 30_000)
    return () => {
      stopped = true
      clearInterval(ping)
      clearTimeout(retry)
      ws?.close()
    }
  }, [])

  // Follow new text while the view is at the bottom
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [state.msgs, state.stream])

  const streaming =
    state.stream && !state.msgs.some((m) => m.id === state.stream?.id)
      ? state.stream
      : null
  const status = !connected
    ? { label: 'Reconnecting…', dot: 'bg-amber-500' }
    : !state.senderOn
      ? { label: "Hi-chat isn't open", dot: 'bg-main-view-fg/30' }
      : { label: 'Live', dot: 'bg-green-500' }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-main-view-fg/10 px-4 py-2">
        <h1 className="flex-1 truncate font-medium">
          {state.title || 'Hi-chat mirror'}
        </h1>
        <span className="flex items-center gap-2 text-main-view-fg/60">
          <span className={cn('size-2 rounded-full', status.dot)} />
          {status.label}
        </span>
      </div>
      <div
        ref={scroller}
        className="flex-1 overflow-y-auto px-4 py-4"
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-4 text-base">
          {state.msgs.length === 0 && !streaming && (
            <p className="text-center text-main-view-fg/50">
              The conversation open in Hi-chat shows here.
            </p>
          )}
          {state.msgs.map((m) => (
            <MirrorMessage key={m.id} role={m.role} text={m.text} />
          ))}
          {streaming && (
            <MirrorMessage role="assistant" text={streaming.text} streaming />
          )}
        </div>
      </div>
    </div>
  )
}

function MirrorMessage({
  role,
  text,
  streaming,
}: {
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
}) {
  const shown = withoutThinking(text)
  if (role === 'user')
    return (
      <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-lg bg-main-view-fg/5 px-4 py-2">
        {shown}
      </div>
    )
  return (
    <div className="w-full">
      <RenderMarkdown content={shown} isStreaming={streaming} />
    </div>
  )
}
