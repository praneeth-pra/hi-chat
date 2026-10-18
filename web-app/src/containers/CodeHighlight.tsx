import type { CSSProperties } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import type { SyntaxHighlighterProps } from 'react-syntax-highlighter'
import * as prismStyles from 'react-syntax-highlighter/dist/cjs/styles/prism'

type Theme = Record<string, CSSProperties>

const ROOT_PRE = 'pre[class*="language-"]'
const ROOT_CODE = 'code[class*="language-"]'

function themeName(codeBlockStyle: string): keyof typeof prismStyles {
  const name = codeBlockStyle
    .split('-')
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join('')
  return name in prismStyles ? (name as keyof typeof prismStyles) : 'oneLight'
}

const cssProperty = (key: string) =>
  key
    .replace(/^(Moz|Webkit|O)(?=[A-Z])/, (p) => `-${p.toLowerCase()}`)
    .replace(/^ms(?=[A-Z])/, '-ms')
    .replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/**
 * A theme's token colours as CSS under `.scope`. Theme keys name Prism tokens
 * ("comment", "attr-value > .token.punctuation") or full selectors
 * (".language-css .token.selector"); the root pre/code rules and the
 * selection, toolbar and plugin rules are left out.
 */
export function themeCss(theme: Theme, scope: string): string {
  const rules: string[] = []
  for (const [key, style] of Object.entries(theme)) {
    if (/^(code|pre|div|:not)\b|selection|toolbar|line-|command-line/.test(key))
      continue
    const selector = /^[a-z]/i.test(key) ? `.token.${key}` : key
    const body = Object.entries(style)
      .map(([k, v]) => `${cssProperty(k)}:${v}`)
      .join(';')
    if (body) rules.push(`.${scope} ${selector}{${body}}`)
  }
  return rules.join('\n')
}

const injected = new Set<string>()
function ensureThemeCss(name: string, theme: Theme) {
  const scope = `hl-${name}`
  if (typeof document !== 'undefined' && !injected.has(scope)) {
    injected.add(scope)
    const el = document.createElement('style')
    el.dataset.codeTheme = name
    el.textContent = themeCss(theme, scope)
    document.head.appendChild(el)
  }
  return scope
}

/**
 * Load language grammars and theme catalog only when a code block is shown.
 * Colours come from a stylesheet per theme, not inline styles: inline mode
 * rescans the whole theme for every token, which made a 25-line block take
 * ~180 ms to draw (~7 ms this way) and froze long chats and streaming.
 */
export default function CodeHighlight({
  codeBlockStyle,
  customStyle,
  codeTagProps,
  ...props
}: SyntaxHighlighterProps & { codeBlockStyle: string }) {
  const name = themeName(codeBlockStyle)
  const theme = prismStyles[name] as Theme
  const scope = ensureThemeCss(name, theme)
  return (
    <div className={scope}>
      <SyntaxHighlighter
        {...props}
        useInlineStyles={false}
        customStyle={{ ...theme[ROOT_PRE], ...customStyle }}
        codeTagProps={{
          ...codeTagProps,
          style: { ...theme[ROOT_CODE], ...codeTagProps?.style },
        }}
      />
    </div>
  )
}
