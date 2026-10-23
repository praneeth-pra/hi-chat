import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { RenderMarkdown } from './RenderMarkdown'
import { useAppState } from '@/hooks/useAppState'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn, extractThinkingContent } from '@/lib/utils'

interface Props {
  text: string
  id: string
  /** How long the model thought, when known (the reply's timings). */
  seconds?: number
}

// Zustand store for thinking block state
type ThinkingBlockState = {
  thinkingState: { [id: string]: boolean }
  setThinkingState: (id: string, expanded: boolean) => void
}

const useThinkingStore = create<ThinkingBlockState>((set) => ({
  thinkingState: {},
  setThinkingState: (id, expanded) =>
    set((state) => ({
      thinkingState: {
        ...state.thinkingState,
        [id]: expanded,
      },
    })),
}))

/** "Thought for 2s" */
export function thoughtFor(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined
  return `Thought for ${Math.max(1, Math.round(seconds))}s`
}

/**
 * The model's thinking, the way ChatGPT and Claude show it: a light line,
 * no box. While it thinks, "Thinking" with a band of light sweeping across
 * it and the latest finished thought beside it, cross-fading to the next.
 * Then "Thought for 2s ›", which opens the reasoning below with a smooth
 * slide.
 */
const ThinkingBlock = ({ id, text, seconds }: Props) => {
  const thinkingState = useThinkingStore((state) => state.thinkingState)
  const setThinkingState = useThinkingStore((state) => state.setThinkingState)
  const isStreaming = useAppState((state) => !!state.streamingContent)
  const { t } = useTranslation()
  // Check for thinking formats
  const hasThinkTag = text.includes('<think>') && !text.includes('</think>')
  const hasAnalysisChannel =
    text.includes('<|channel|>analysis<|message|>') &&
    !text.includes('<|start|>assistant<|channel|>final<|message|>')
  const loading = (hasThinkTag || hasAnalysisChannel) && isStreaming
  const isExpanded = thinkingState[id] ?? false

  // Timed here when it's thought on this screen; the reply's timings for
  // an earlier one
  const started = useRef<number | undefined>(undefined)
  const [measured, setMeasured] = useState<number>()
  useEffect(() => {
    if (loading && started.current === undefined)
      started.current = performance.now()
    if (!loading && started.current !== undefined && measured === undefined)
      setMeasured((performance.now() - started.current) / 1000)
  }, [loading, measured])

  const thinkingContent = extractThinkingContent(text)
  // Its latest finished thought (a line scrolling with every word was busy)
  const thoughts = thinkingContent
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
  const finished = /[.!?]\s*$/.test(thinkingContent)
    ? thoughts.length
    : thoughts.length - 1
  const latestThought = finished > 0 ? thoughts[finished - 1] : ''
  if (!thinkingContent) return null

  const label = loading
    ? t('common:thinking')
    : (thoughtFor(measured ?? seconds) ?? t('common:thought'))

  return (
    <div className="mb-3 w-full animate-in fade-in duration-300">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setThinkingState(id, !isExpanded)}
          className="group flex shrink-0 items-center gap-1 text-main-view-fg/55 hover:text-main-view-fg/80 cursor-pointer focus:outline-none"
        >
          <span className={cn('font-medium', loading && 'thinking-shimmer')}>
            {label}
          </span>
          <ChevronRight
            className={cn(
              'size-3.5 transition-transform duration-200',
              isExpanded && 'rotate-90'
            )}
          />
        </button>
        {loading && !isExpanded && latestThought && (
          <span
            aria-hidden
            key={finished}
            data-test-id="thinking-ticker"
            className="min-w-0 flex-1 truncate text-main-view-fg/40 animate-in fade-in duration-500"
          >
            {latestThought}
          </span>
        )}
      </div>
      {/* Opens and closes with a slide: the row's height animates from 0 */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out',
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          {isExpanded && (
            <div className="mt-2 border-l-2 border-main-view-fg/10 pl-3 text-sm text-main-view-fg/55">
              <RenderMarkdown content={thinkingContent} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ThinkingBlock
