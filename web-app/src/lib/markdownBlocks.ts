// Streaming markdown, drawn in blocks (containers/MirrorView.tsx).

/**
 * Splits markdown into blocks at blank lines, never inside a code block.
 * A streaming answer draws each finished block once; only the last one,
 * still being written, is drawn again as text arrives.
 */
export function markdownBlocks(text: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1]
    if (marker) {
      if (fence === null) fence = marker[0]
      else if (marker[0] === fence) fence = null
    }
    if (fence === null && !marker && line.trim() === '' && current.length) {
      blocks.push(current.join('\n'))
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length) blocks.push(current.join('\n'))
  return blocks
}

/**
 * The chat's version (containers/RenderMarkdown.tsx): an answer split into its top-level markdown blocks (paragraphs, lists,
 * code, tables, maths), so while it streams only the block being written is
 * parsed and drawn again; the ones before it are finished and stay as they
 * are.
 *
 * Splits at blank lines, except inside a code fence or a $$ maths block, or
 * before an indented line (a list item's continuation, which on its own
 * would read as indented code).
 */
export function splitMarkdownBlocks(text: string): string[] {
  const lines = text.split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let fence: string | null = null
  let maths = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    const opener = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (opener && opener[0] === fence[0] && opener.length >= fence.length)
        fence = null
    } else if (opener) {
      fence = opener
    } else if (trimmed === '$$') {
      maths = !maths
    }
    if (trimmed === '' && !fence && !maths && current.length) {
      const next = lines.slice(i + 1).find((l) => l.trim() !== '')
      if (next === undefined || !/^\s/.test(next)) {
        blocks.push(current.join('\n'))
        current = []
        continue
      }
    }
    if (trimmed === '' && !current.length) continue
    current.push(line)
  }
  if (current.length) blocks.push(current.join('\n'))
  return blocks
}
