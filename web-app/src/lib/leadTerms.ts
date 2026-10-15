import type { Element, ElementContent, Root } from 'hast'

/**
 * Answers are read at a glance during interviews, and most bullets start
 * with a bold key term ("**Contract tests:** run Pact ..."). This rehype
 * plugin tags that opening bold term with `lead-term` so it can take the
 * accent colour. Bold words later in a bullet are left alone.
 */
const isBlank = (node: ElementContent) =>
  node.type === 'text' && !node.value.trim()

const firstContent = (el: Element) => el.children.find((c) => !isBlank(c))

function markLeadTerm(li: Element) {
  let first = firstContent(li)
  // Loose lists wrap the bullet's text in a <p>
  if (first?.type === 'element' && first.tagName === 'p') {
    first = firstContent(first)
  }
  if (first?.type !== 'element' || first.tagName !== 'strong') return
  const existing = first.properties.className
  const classes = Array.isArray(existing)
    ? existing.map(String)
    : existing
      ? [String(existing)]
      : []
  first.properties.className = [...classes, 'lead-term']
}

function walk(node: Root | Element) {
  for (const child of node.children) {
    if (child.type !== 'element') continue
    if (child.tagName === 'li') markLeadTerm(child)
    walk(child)
  }
}

export function rehypeLeadTerms() {
  return (tree: Root) => walk(tree)
}
