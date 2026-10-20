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
