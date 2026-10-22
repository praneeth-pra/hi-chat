// Wraps each word of the block being written in <span class="stream-word">,
// which fades in once (markdown.css). React keeps a word's span as more
// words arrive after it, so each word fades in only when it first appears.
// Code, maths and SVG are left as they are.

type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: { className?: unknown }
  children?: HastNode[]
}

const SKIP_TAGS = new Set(['code', 'pre', 'svg', 'math', 'annotation'])

const isSkipped = (node: HastNode) => {
  if (node.type !== 'element') return false
  if (SKIP_TAGS.has(node.tagName ?? '')) return true
  const cls = node.properties?.className
  const names = Array.isArray(cls) ? cls.map(String) : cls ? [String(cls)] : []
  return names.some((c) => c.startsWith('katex') || c.startsWith('math'))
}

function wrap(node: HastNode) {
  if (!node.children || isSkipped(node)) return
  const out: HastNode[] = []
  for (const child of node.children) {
    if (child.type !== 'text' || !child.value) {
      wrap(child)
      out.push(child)
      continue
    }
    for (const part of child.value.split(/(\s+)/)) {
      if (!part) continue
      if (/^\s+$/.test(part)) out.push({ type: 'text', value: part })
      else
        out.push({
          type: 'element',
          tagName: 'span',
          properties: { className: ['stream-word'] },
          children: [{ type: 'text', value: part }],
        })
    }
  }
  node.children = out
}

export function rehypeFadeWords() {
  return (tree: HastNode) => wrap(tree)
}
