import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import type { SyntaxHighlighterProps } from 'react-syntax-highlighter'
import * as prismStyles from 'react-syntax-highlighter/dist/cjs/styles/prism'

/** Load language grammars and theme catalog only when a code block is shown. */
export default function CodeHighlight({
  codeBlockStyle,
  ...props
}: SyntaxHighlighterProps & { codeBlockStyle: string }) {
  const theme = codeBlockStyle
    .split('-')
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join('')
  return (
    <SyntaxHighlighter
      {...props}
      style={
        prismStyles[theme as keyof typeof prismStyles] || prismStyles.oneLight
      }
    />
  )
}
