import { lazy, Suspense, type ComponentProps } from 'react'

/**
 * The JSON editor in a few dialogs. It brings syntax colours for hundreds of
 * languages (about 1 MB), so it loads only when a dialog that shows it opens;
 * meanwhile the text shows plain.
 */
const CodeEditor = lazy(() => import('./CodeEditorWithStyles'))

type Props = ComponentProps<typeof CodeEditor>

export default function LazyCodeEditor(props: Props) {
  const { value, className, style } = props
  return (
    <Suspense
      fallback={
        <pre
          className={className}
          style={{ ...style, margin: 0, padding: 10, whiteSpace: 'pre-wrap' }}
        >
          {value}
        </pre>
      }
    >
      <CodeEditor {...props} />
    </Suspense>
  )
}
