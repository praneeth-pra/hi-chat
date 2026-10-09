/**
 * Models often answer with a table even when told not to. With this on (the
 * default), a markdown table in an answer is shown as a bullet list instead:
 * one bullet per row, led by its first cell. Code blocks are left alone.
 */
export const TABLES_AS_LISTS_STORAGE_KEY = 'tables-as-lists'

export function getTablesAsLists(): boolean {
  try {
    return localStorage.getItem(TABLES_AS_LISTS_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setTablesAsLists(on: boolean) {
  try {
    localStorage.setItem(TABLES_AS_LISTS_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Storage blocked: the default stays in effect
  }
}

const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line)
const isDivider = (line: string) =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) &&
  line.includes('-')

/** The cells of a table row, without the outer pipes; `\|` stays a pipe. */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split(/(?<!\\)\|/).map((c) =>
    c
      .trim()
      .replace(/\\\|/g, '|')
      .replace(/<br\s*\/?>/gi, ' ')
  )
}

function rowToBullet(header: string[], row: string[]): string {
  const [first, ...rest] = row
  const details = rest
    .map((value, i) => ({ name: header[i + 1] ?? '', value }))
    .filter((d) => d.value)
  if (!first && !details.length) return ''
  // Two columns read as "name: value"; more get their column names
  const parts =
    header.length <= 2
      ? details.map((d) => d.value)
      : details.map((d) => (d.name ? `${d.name}: ${d.value}` : d.value))
  return `- **${first}**${parts.length ? `: ${parts.join('; ')}` : ''}`
}

/** Rewrites every complete markdown table outside code blocks as bullets. */
export function tablesToLists(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let fence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const marker = /^\s*(```|~~~)/.exec(line)?.[1]
    if (marker) {
      fence = fence === marker ? null : (fence ?? marker)
      out.push(line)
      continue
    }
    if (fence || !isRow(line) || !isDivider(lines[i + 1] ?? '')) {
      out.push(line)
      continue
    }
    const header = cells(line)
    let j = i + 2
    const bullets: string[] = []
    while (j < lines.length && isRow(lines[j])) {
      const bullet = rowToBullet(header, cells(lines[j]))
      if (bullet) bullets.push(bullet)
      j++
    }
    // A list needs a blank line before it to render as one
    if (out.length && out[out.length - 1].trim()) out.push('')
    out.push(...bullets)
    i = j - 1
  }
  return out.join('\n')
}
