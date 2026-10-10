import fixesFile from './dictation-fixes.txt?raw'

/**
 * Known dictation mistakes and their fixes (dictation-fixes.txt), applied to
 * every engine's text before the engines are compared, so a mistake two
 * engines share is fixed even when the judge is skipped.
 */

export type Fix = { from: RegExp; to: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function parseFixes(file: string): Fix[] {
  return file
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('=>'))
    .map((line) => {
      const [wrong, right] = line.split('=>').map((s) => s.trim())
      const words = wrong.split(/\s+/).map(escape).join('[\\s,-]+')
      return {
        from: new RegExp(
          `(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`,
          'giu'
        ),
        to: right,
      }
    })
    .filter((f) => f.to)
}

const FIXES = parseFixes(fixesFile)

export function applyFixes(text: string, fixes: Fix[] = FIXES): string {
  return fixes.reduce((t, f) => t.replace(f.from, f.to), text)
}
