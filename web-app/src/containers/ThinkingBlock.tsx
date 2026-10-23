import { Brain, ChevronDown, ChevronUp, Loader } from 'lucide-react'
import { create } from 'zustand'
import { RenderMarkdown } from './RenderMarkdown'
import { useAppState } from '@/hooks/useAppState'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn, extractThinkingContent } from '@/lib/utils'
import { useSmoothText } from '@/lib/useSmoothText'

interface Props {
  text: string
  id: string
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

const ThinkingBlock = ({ id, text }: Props) => {
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
  // Stays one line unless tapped: opening while it thinks and snapping shut
  // when the answer starts made the page jump.
  const isExpanded = thinkingState[id] ?? false
  const handleClick = () => {
    const newExpandedState = !isExpanded
    setThinkingState(id, newExpandedState)
  }

  const thinkingContent = extractThinkingContent(text)
  // The thinking glides along the line at a steady pace, rather than
  // jumping by a burst of words at a time
  const tickerText = useSmoothText(
    thinkingContent.replace(/\s+/g, ' '),
    loading
  ).slice(-240)
  if (!thinkingContent) return null

  return (
    <div
      className="mx-auto w-full cursor-pointer break-words animate-in fade-in duration-200"
      onClick={handleClick}
    >
      <div className="mb-4 rounded-lg bg-main-view-fg/4 border border-dashed border-main-view-fg/10 p-2">
        <div className="flex items-center gap-3">
          {/* One slot for the spinner and, once done, the icon: the label
              doesn't shift sideways when thinking ends */}
          {loading ? (
            <Loader className="size-4 shrink-0 animate-spin text-main-view-fg/60" />
          ) : (
            <Brain className="size-4 shrink-0 text-main-view-fg/45 animate-in fade-in duration-200" />
          )}
          <button className="flex shrink-0 items-center gap-2 focus:outline-none">
            {isExpanded ? (
              <ChevronUp className="size-4 text-main-view-fg/60" />
            ) : (
              <ChevronDown className="size-4 text-main-view-fg/60" />
            )}
            <span
              className={cn(
                'font-medium',
                loading && 'animate-[thinking-pulse_1.6s_ease-in-out_infinite]'
              )}
            >
              {loading ? t('common:thinking') : t('common:thought')}
            </span>
          </button>
          {/* While it thinks: its latest words slide past on one line (the
              box keeps its height), so something moves from the first
              tokens instead of a still label */}
          {loading && !isExpanded && (
            <span
              aria-hidden
              data-test-id="thinking-ticker"
              className="flex min-w-0 flex-1 justify-end overflow-hidden text-sm text-main-view-fg/45 [mask-image:linear-gradient(to_right,transparent,black_32px)]"
            >
              <span className="whitespace-nowrap">{tickerText}</span>
            </span>
          )}
        </div>

        {isExpanded && (
          <div className="mt-2 pl-6 pr-4 text-main-view-fg/60">
            <RenderMarkdown content={thinkingContent} />
          </div>
        )}
      </div>
    </div>
  )
}

export default ThinkingBlock
