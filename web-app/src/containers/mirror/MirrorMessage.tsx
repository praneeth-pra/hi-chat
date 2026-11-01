import { memo, useEffect, useMemo, useState } from 'react'
import {
  IconCopy,
  IconCopyCheck,
  IconLoader2,
  IconTool,
} from '@tabler/icons-react'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { AccuracyReviewInfo } from '@/containers/ThreadContent'
import ThinkingBlock from '@/containers/ThinkingBlock'
import type { AccuracyReview } from '@/lib/accuracyReview'
import { useSmoothText } from '@/lib/useSmoothText'
import { splitReasoning } from '@/lib/splitReasoning'
import type { MirrorMessage as MirrorMessageData } from '@/lib/remoteMirror'
import { cn } from '@/lib/utils'
import { IN_STEP_MS, inStepLength, useInStep } from './inStep'

// Re-rendered only when its own text changes, not on every scroll or word
// elsewhere: rendering a long chat's markdown again would lag the scroll
/**
 * One message, drawn as Hi-chat's chat draws it (ThreadContent): a question
 * with its files and screenshots, an answer with its thinking folded, its
 * Accuracy review and the tools it used. Drawn again only when it changes.
 */
export const MirrorMessage = memo(
  function MirrorMessage({
    msg,
    images,
    streaming,
    shown,
    last,
  }: {
    msg: MirrorMessageData
    /** Its screenshots, as they arrive (undefined until then) */
    images?: (string | undefined)[]
    streaming?: boolean
    /** How much of its answer Hi-chat shows right now, while it reveals it */
    shown?: number
    /** The last message (its buttons show, as in Hi-chat) */
    last?: boolean
  }) {
    // Spaced as Hi-chat's chat spaces its messages
    if (msg.role === 'user')
      return (
        <div data-mid={msg.id || undefined} className="mb-4 w-full">
          {msg.text && (
            <div className="flex w-full justify-end break-words pt-4 text-start">
              <div className="relative max-w-[90%] rounded-3xl bg-surface px-5 py-2.5 text-main-view-fg">
                <RenderMarkdown content={msg.text} isUser />
              </div>
            </div>
          )}
          {!!msg.files?.length && (
            <div className="mt-2 mb-2 flex w-full justify-end">
              <div className="flex max-w-[80%] flex-wrap justify-end gap-2">
                {msg.files.map((name, i) => (
                  <span
                    key={i}
                    className="max-w-48 truncate rounded-md border border-main-view-fg/10 bg-main-view-fg/5 px-3 py-2 text-xs"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {!!msg.images?.length && (
            <div className="mb-2 flex w-full justify-end">
              <div className="flex max-w-[80%] flex-wrap justify-end gap-2">
                {msg.images.map((key, i) => (
                  <MirrorImage key={key} src={images?.[i]} />
                ))}
              </div>
            </div>
          )}
          {/* Where Hi-chat has its edit and delete buttons */}
          <div aria-hidden className="mt-1.5 h-4" />
        </div>
      )
    return (
      <MirrorAnswer msg={msg} streaming={streaming} shown={shown} last={last} />
    )
  },
  // The same message, the same screenshots: nothing to draw again
  (a, b) =>
    a.msg === b.msg &&
    a.streaming === b.streaming &&
    a.shown === b.shown &&
    a.last === b.last &&
    (a.images ?? []).length === (b.images ?? []).length &&
    (a.images ?? []).every((src, i) => src === b.images?.[i])
)

/**
 * An answer drawn exactly as Hi-chat's chat draws it (ThreadContent): the
 * text revealed at a steady pace rather than in the bursts it arrives in,
 * new words fading in, finished blocks never drawn again, and the same
 * drawing once it is saved, so nothing jumps when it finishes.
 */
function MirrorAnswer({
  msg,
  streaming,
  shown,
  last,
}: {
  msg: MirrorMessageData
  streaming?: boolean
  shown?: number
  last?: boolean
}) {
  const { reasoningSegment, textSegment } = useMemo(
    () => splitReasoning(msg.text),
    [msg.text]
  )
  const full = textSegment.replace('</think>', '')
  // Its own steady pace, for when Hi-chat isn't saying how much it shows (a
  // window in the background barely draws)
  const paced = useSmoothText(full, !!streaming, true)
  const step = useInStep()
  const { n, fresh } = inStepLength(
    step,
    full.length,
    paced.length,
    shown,
    performance.now()
  )
  const answer = n >= full.length ? full : full.slice(0, n)
  // If Hi-chat goes quiet partway (its window went to the background), look
  // again shortly, then carry on at this page's own pace, a frame at a time
  const [, recheck] = useState(0)
  useEffect(() => {
    if (shown === undefined || n >= full.length) return
    if (fresh) {
      const later = setTimeout(() => recheck((x) => x + 1), IN_STEP_MS)
      return () => clearTimeout(later)
    }
    const frame = requestAnimationFrame(() => recheck((x) => x + 1))
    return () => cancelAnimationFrame(frame)
  }, [shown, n, fresh, full.length])
  return (
    <div data-mid={msg.id || undefined} className="group/answer mb-4 w-full">
      {reasoningSegment && (
        <ThinkingBlock
          id={`mirror-${msg.id || 'streaming'}`}
          text={reasoningSegment}
          seconds={msg.thinking}
        />
      )}
      {streaming && !reasoningSegment && !answer.trim() && (
        <span
          aria-label="Answer on its way"
          className="relative flex size-5 items-center justify-center text-main-view-fg/70"
        >
          <span className="absolute inset-0 rounded-full bg-current opacity-15 animate-[breathe_1.8s_ease-in-out_infinite]" />
          <span className="relative size-2 rounded-full bg-current animate-[breathe-core_1.8s_ease-in-out_infinite]" />
        </span>
      )}
      <RenderMarkdown
        content={answer}
        streamable
        isStreaming={!!streaming || answer.length < full.length}
      />
      {msg.review && (
        <AccuracyReviewInfo review={msg.review as unknown as AccuracyReview} />
      )}
      {!!msg.tools?.length && (
        <div className="mt-2 flex flex-wrap gap-2">
          {msg.tools.map((tool, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-md border border-main-view-fg/10 bg-main-view-fg/5 px-2 py-1 text-xs text-main-view-fg/70"
            >
              {tool.pending ? (
                <IconLoader2 size={12} className="animate-spin" />
              ) : (
                <IconTool size={12} />
              )}
              {tool.name || 'Tool'}
            </span>
          ))}
        </div>
      )}
      {/* Where Hi-chat has its buttons: shown under the last answer, the
          others on hover. Copy works here too */}
      {!msg.tools?.length && (
        <div
          className={cn(
            'mt-1 flex items-center gap-3 text-xs text-main-view-fg/45',
            !last &&
              'md:opacity-0 md:group-hover/answer:opacity-100 focus-within:opacity-100 transition-opacity'
          )}
        >
          {!streaming && <MirrorCopy text={full} />}
        </div>
      )}
    </div>
  )
}

function MirrorCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title="Copy"
      aria-label="Copy the answer"
      onClick={() =>
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => {})
      }
      className="flex items-center gap-1 transition-colors hover:text-accent"
    >
      {copied ? <IconCopyCheck size={16} /> : <IconCopy size={16} />}
    </button>
  )
}

/** A screenshot: small like Hi-chat's, full width with a click. */
function MirrorImage({ src }: { src?: string }) {
  const [big, setBig] = useState(false)
  if (!src)
    return (
      <span
        aria-label="Screenshot loading"
        className="size-40 animate-pulse rounded-md border border-main-view-fg/10 bg-main-view-fg/5"
      />
    )
  return (
    <button
      type="button"
      onClick={() => setBig((b) => !b)}
      title={big ? 'Smaller' : 'Bigger'}
      className={cn('block', big && 'w-full')}
    >
      <img
        src={src}
        alt="Attached screenshot"
        className={cn(
          'rounded-md border border-main-view-fg/10',
          big ? 'w-full object-contain' : 'size-40 object-cover'
        )}
      />
    </button>
  )
}
