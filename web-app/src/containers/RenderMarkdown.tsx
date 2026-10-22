import ReactMarkdown, { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkEmoji from 'remark-emoji'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import {
  lazy,
  Suspense,
  memo,
  useState,
  useMemo,
  useCallback,
  useEffect,
  createContext,
  useContext,
  useDeferredValue,
} from 'react'
import { splitMarkdownBlocks } from '@/lib/markdownBlocks'
import { rehypeFadeWords } from '@/lib/rehypeFadeWords'
import { getReadableLanguageName } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { useCodeblock } from '@/hooks/useCodeblock'
import { useTheme } from '@/hooks/useTheme'
import { IconCopy, IconCopyCheck } from '@tabler/icons-react'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Pluggable, PluggableList } from 'unified'
import { remarkTablesAsLists } from '@/lib/tablesToLists'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { FlowDiagram, TreeLayout, isDiagramLanguage } from './DiagramBlocks'

// Same box as highlighted code, so if the highlighter isn't loaded yet only
// the colours change when it arrives, not the layout
const CODE_PADDING = '12px 8px'
function PlainCode({ children }: { children: string | string[] }) {
  return (
    <pre
      className="overflow-auto whitespace-pre-wrap"
      style={{ margin: 0, padding: CODE_PADDING }}
    >
      <code>{children}</code>
    </pre>
  )
}
const loadCodeHighlight = () =>
  import('./CodeHighlight').catch(() => ({ default: PlainCode }))
const CodeHighlight =
  lazy<(typeof import('./CodeHighlight'))['default']>(loadCodeHighlight)
/**
 * KaTeX draws maths. It isn't needed to open Hi-chat, so it loads on its own:
 * while idle, or as soon as a reply has maths in it, which then redraws.
 */
let katexPlugin: Pluggable | undefined
let katexLoading: Promise<Pluggable | undefined> | undefined
const loadKatex = () =>
  (katexLoading ??= import('./katexPlugin')
    .then((m) => (katexPlugin = m.default as Pluggable))
    .catch(() => {
      katexLoading = undefined // try again next time
      return undefined
    }))
/** Maths as remark-math reads it: $…$, $$…$$ (normalizeLatex turns \( \[ into these). */
const hasMath = (text: string) => text.includes('$')
function useKatex(needed: boolean): Pluggable | undefined {
  const [plugin, setPlugin] = useState(() => katexPlugin)
  useEffect(() => {
    if (!needed || plugin) return
    let live = true
    void loadKatex().then((p) => {
      if (live && p) setPlugin(() => p)
    })
    return () => {
      live = false
    }
  }, [needed, plugin])
  return plugin
}
// Fetch the highlighter and KaTeX while idle, so the first answer's code and
// maths are drawn right from the start instead of switching over later
if (typeof window !== 'undefined') {
  const idle = () => {
    void loadCodeHighlight()
    void loadKatex()
  }
  if ('requestIdleCallback' in window) requestIdleCallback(idle)
  else setTimeout(idle, 1000)
}

interface MarkdownProps {
  content: string
  /**
   * An answer that streams: drawn block by block (only the block being
   * written is parsed again), with new words fading in.
   */
  streamable?: boolean
  className?: string
  components?: Components
  enableRawHtml?: boolean
  isUser?: boolean
  isWrapping?: boolean
  isStreaming?: boolean
}

const markdownSchema: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
  },
}

/**
 * Optimized preprocessor: normalize LaTeX fragments into $ / $$.
 * The component memoizes the current content instead of retaining stream prefixes.
 */
const normalizeLatex = (input: string): string => {
  const segments = input.split(/(```[\s\S]*?```|`[^`]*`|<[^>]+>)/g)

  const result = segments
    .map((segment) => {
      if (!segment) return ''

      // Skip code blocks, inline code, html tags
      if (/^```[\s\S]*```$/.test(segment)) return segment
      if (/^`[^`]*`$/.test(segment)) return segment
      if (/^<[^>]+>$/.test(segment)) return segment

      let s = segment

      // --- Display math: \[...\] surrounded by newlines
      s = s.replace(
        /(^|\n)\\\[\s*\n([\s\S]*?)\n\s*\\\](?=\n|$)/g,
        (_, pre, inner) => `${pre}$$\n${inner.trim()}\n$$`
      )

      // --- Inline math: space \( ... \)
      s = s.replace(
        /(^|[^$\\])\\\((.+?)\\\)(?=[^$\\]|$)/g,
        (_, pre, inner) => `${pre}$${inner.trim()}$`
      )

      // --- Escape $<number> to prevent Markdown from treating it as LaTeX
      // Example: "$1" → "\$1"
      s = s.replace(/\$(\d+)/g, (_, num) => '\\$' + num)

      return s
    })
    .join('')

  return result
}

function codeIdFor(code: string, language: string) {
  let hash = 0
  for (let i = 0; i < code.length; i++) {
    const char = code.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return `code-${Math.abs(hash)}-${language}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CodeProps = Record<string, any>

/** Blocks longer than this are coloured on request, not while streaming. */
const LARGE_CODE = 4000

/**
 * react-markdown hands every block a new `node` on each streamed update, so
 * a plain memo redrew (and re-highlighted) every code block in the answer on
 * every update. A block only redraws when what it shows changes; the copy
 * state only matters to the block that was copied.
 */
export function sameCode(prev: CodeProps, next: CodeProps): boolean {
  const keys = [
    'className',
    'isUser',
    'codeBlockStyle',
    'showLineNumbers',
    'isWrapping',
    'isStreaming',
    'onCopy',
  ]
  if (keys.some((k) => prev[k] !== next[k])) return false
  const code = String(next.children)
  if (String(prev.children) !== code) return false
  if (prev.copiedId === next.copiedId) return true
  const language = /language-([^\s]+)/.exec(next.className || '')?.[1] ?? ''
  const id = codeIdFor(code.replace(/\n$/, ''), language)
  return prev.copiedId !== id && next.copiedId !== id
}

// Memoized code component to prevent unnecessary re-renders
const CodeComponent = memo(
  ({
    className,
    children,
    isUser,
    codeBlockStyle,
    showLineNumbers,
    isWrapping,
    isStreaming,
    onCopy,
    copiedId,
    ...props
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }: any) => {
    const { t } = useTranslation()
    const match = /language-([^\s]+)/.exec(className || '')
    const language = match ? match[1] : ''
    const isInline = !match || !language

    const code = String(children).replace(/\n$/, '')
    const [highlightedCode, setHighlightedCode] = useState<string | null>(null)
    // A block still being written shows as plain text: colouring it again on
    // every update was the heaviest work while streaming. It's coloured once,
    // in the same box, as soon as it's complete. Tokenizing a large block
    // creates thousands of spans, so those are coloured on request.
    const largeCode = code.length > LARGE_CODE
    const highlight = !isStreaming && (!largeCode || highlightedCode === code)

    // Generate a stable ID based on content hash instead of position
    const codeId = useMemo(() => codeIdFor(code, language), [code, language])

    const handleCopyClick = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation()
        onCopy(code, codeId)
      },
      [code, codeId, onCopy]
    )

    if (isInline || isUser) {
      return <code className={cn(className)}>{children}</code>
    }

    if (isDiagramLanguage(language)) {
      return language === 'flow' ? (
        <FlowDiagram code={code} />
      ) : (
        <TreeLayout code={code} />
      )
    }

    return (
      <div
        data-code-block
        className="relative overflow-hidden rounded-xl bg-surface border border-main-view-fg/[0.06] scroll-mt-4 my-1"
      >
        <style>
          {`
        .react-syntax-highlighter-line-number {
          user-select: none;
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
        }
      `}
        </style>
        <div className="flex items-center justify-between px-4 py-2 text-main-view-fg/55">
          <span className="font-medium text-xs font-sans">
            {getReadableLanguageName(language)}
          </span>
          {!isStreaming && largeCode && !highlight && (
            <button
              className="ml-auto mr-3 text-xs cursor-pointer"
              onClick={() => setHighlightedCode(code)}
            >
              Highlight code
            </button>
          )}
          <button
            onClick={handleCopyClick}
            className="flex items-center gap-1 text-xs font-sans transition-colors cursor-pointer"
          >
            {copiedId === codeId ? (
              <>
                <IconCopyCheck size={16} className="text-primary" />
                <span>{t('copied')}</span>
              </>
            ) : (
              <>
                <IconCopy size={16} />
                <span>{t('copy')}</span>
              </>
            )}
          </button>
        </div>
        {highlight ? (
          <Suspense fallback={<PlainCode>{code}</PlainCode>}>
            <CodeHighlight
              codeBlockStyle={codeBlockStyle}
              language={language}
              showLineNumbers={showLineNumbers}
              wrapLines={true}
              // Wrap long lines by default so narrow windows never scroll sideways
              lineProps={
                isWrapping !== false
                  ? {
                      style: {
                        overflowWrap: 'anywhere',
                        whiteSpace: 'pre-wrap',
                      },
                    }
                  : {}
              }
              codeTagProps={
                isWrapping !== false
                  ? {
                      style: {
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                      },
                    }
                  : undefined
              }
              customStyle={{
                margin: 0,
                padding: CODE_PADDING,
                borderRadius: 0,
                overflow: 'auto',
                border: 'none',
              }}
              PreTag="div"
              CodeTag={'code'}
              {...props}
            >
              {code}
            </CodeHighlight>
          </Suspense>
        ) : (
          <PlainCode>{code}</PlainCode>
        )}
      </div>
    )
  },
  sameCode
)

CodeComponent.displayName = 'CodeComponent'

type CodeOptions = {
  isUser?: boolean
  codeBlockStyle: string
  showLineNumbers: boolean
  isWrapping?: boolean
  isStreaming: boolean
  onCopy: (code: string, id: string) => void
  copiedId: string | null
}
const CodeOptionsContext = createContext<CodeOptions | null>(null)

/**
 * The one `code` component markdown is drawn with. It stays the same
 * function for the life of the answer and reads the options from context:
 * a new function each time an option changed (the answer finishing, a
 * copy) made React throw every code block away and build it again.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MarkdownCode(props: any) {
  const options = useContext(CodeOptionsContext)
  return <CodeComponent {...props} {...options} />
}

type BlockProps = {
  text: string
  live: boolean
  remarkPlugins: PluggableList
  rehypePlugins: PluggableList
  components: Components
}

/** One block of a streamable answer; a finished block is never redrawn. */
const MarkdownBlock = memo(function MarkdownBlock({
  text,
  live,
  remarkPlugins,
  rehypePlugins,
  components,
}: BlockProps) {
  const parent = useContext(CodeOptionsContext)
  const options = useMemo(
    () => (parent ? { ...parent, isStreaming: live } : null),
    [parent, live]
  )
  const normalized = useMemo(() => normalizeLatex(text), [text])
  const rehype = useMemo<PluggableList>(
    () => (live ? [...rehypePlugins, rehypeFadeWords] : rehypePlugins),
    [live, rehypePlugins]
  )
  return (
    <CodeOptionsContext.Provider value={options}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehype}
        components={components}
      >
        {normalized}
      </ReactMarkdown>
    </CodeOptionsContext.Provider>
  )
})

function RenderMarkdownComponent({
  streamable = false,
  content,
  enableRawHtml,
  className,
  isUser,
  components,
  isWrapping,
  isStreaming = false,
}: MarkdownProps) {
  const { codeBlockStyle: chosenCodeStyle, showLineNumbers } = useCodeblock()
  const isDark = useTheme((state) => state.isDark)
  // The default dark code theme sits oddly in a light page: light mode
  // shows the matching light theme unless another style was picked
  const codeBlockStyle =
    chosenCodeStyle === 'vsc-dark-plus' && !isDark
      ? 'one-light'
      : chosenCodeStyle

  // State for tracking which code block has been copied
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Memoized copy handler
  const handleCopy = useCallback((code: string, id: string) => {
    navigator.clipboard.writeText(code)
    setCopiedId(id)

    // Reset copied state after 2 seconds
    setTimeout(() => {
      setCopiedId(null)
    }, 2000)
  }, [])

  // Drawing the text yields to animations and typing: React may skip an
  // update when a newer one is already waiting
  const deferredContent = useDeferredValue(content)
  const shownContent = streamable ? deferredContent : content
  // Memoize the normalized content to avoid reprocessing on every render
  const normalizedContent = useMemo(
    () => (streamable ? '' : normalizeLatex(shownContent)),
    [streamable, shownContent]
  )
  const blocks = useMemo(
    () => (streamable ? splitMarkdownBlocks(shownContent) : []),
    [streamable, shownContent]
  )

  // Stable remarkPlugins reference
  const remarkPlugins = useMemo<PluggableList>(() => {
    const plugins: PluggableList = [
      remarkGfm,
      remarkMath,
      remarkEmoji,
      remarkBreaks,
    ]
    // User input and external HTML documents retain their original format.
    if (!isUser && !enableRawHtml) plugins.push(remarkTablesAsLists)
    return plugins
  }, [isUser, enableRawHtml])

  const katex = useKatex(hasMath(streamable ? shownContent : normalizedContent))

  // Stable rehypePlugins reference
  const rehypePlugins = useMemo<PluggableList>(() => {
    const maths = katex ? [katex] : []
    // Sanitize external HTML before KaTeX generates its trusted markup.
    return enableRawHtml
      ? [rehypeRaw, [rehypeSanitize, markdownSchema], ...maths]
      : maths
  }, [enableRawHtml, katex])

  const codeOptions = useMemo<CodeOptions>(
    () => ({
      isUser,
      codeBlockStyle,
      showLineNumbers,
      isWrapping,
      // A streamable answer's blocks say for themselves
      isStreaming: streamable ? false : isStreaming,
      onCopy: handleCopy,
      copiedId,
    }),
    [
      isUser,
      codeBlockStyle,
      showLineNumbers,
      isWrapping,
      isStreaming,
      streamable,
      handleCopy,
      copiedId,
    ]
  )

  const markdownComponents: Components = useMemo(
    () => ({ code: MarkdownCode, ...components }),
    [components]
  )

  // The parsed answer only changes with its text: the answer finishing or a
  // copy reaches the code blocks through context, without parsing it again
  const tree = useMemo(
    () =>
      streamable ? null : (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={markdownComponents}
        >
          {normalizedContent}
        </ReactMarkdown>
      ),
    [
      streamable,
      remarkPlugins,
      rehypePlugins,
      markdownComponents,
      normalizedContent,
    ]
  )

  // Render the markdown content
  return (
    <div
      className={cn(
        'markdown break-words select-text',
        isUser && 'is-user',
        className
      )}
    >
      <CodeOptionsContext.Provider value={codeOptions}>
        {streamable
          ? blocks.map((block, i) => (
              <MarkdownBlock
                // By position: a block keeps its place as the answer grows
                key={i}
                text={block}
                live={isStreaming && i === blocks.length - 1}
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={markdownComponents}
              />
            ))
          : tree}
      </CodeOptionsContext.Provider>
    </div>
  )
}
export const RenderMarkdown = memo(RenderMarkdownComponent)
