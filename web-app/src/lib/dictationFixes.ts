import fixesFile from './dictation-fixes.txt?raw'
import { englishOnly } from './englishOnly'

/**
 * Known dictation mistakes and their fixes (dictation-fixes.txt), applied to
 * every engine's text before the engines are compared, so a mistake two
 * engines share is fixed even when the judge is skipped. Words in other
 * scripts are dropped first, since dictation is English only.
 *
 * A fix can name context words after "@": "forget => Fargate @ ECS, EKS"
 * only applies when one of them is in the same dictation, so an ordinary
 * "I forget" is left alone.
 */

export type Fix = { from: RegExp; to: string; when?: RegExp }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function parseFixes(file: string): Fix[] {
  return file
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('=>'))
    .map((line) => {
      const [wrong, rest] = line.split('=>').map((s) => s.trim())
      const [right, context] = rest.split(/\s@\s?/).map((s) => s.trim())
      const phrase = (text: string) =>
        text.split(/\s+/).map(escape).join('[\\s,-]+')
      const whole = (pattern: string) =>
        `(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`
      const when = context
        ?.split(',')
        .map((w) => w.trim())
        .filter(Boolean)
      return {
        from: new RegExp(whole(phrase(wrong)), 'giu'),
        to: right,
        ...(when?.length
          ? { when: new RegExp(whole(when.map(phrase).join('|')), 'iu') }
          : {}),
      }
    })
    .filter((f) => f.to)
}

const FIXES = parseFixes(fixesFile)

export function applyFixes(text: string, fixes: Fix[] = FIXES): string {
  // Context is checked on the text so far, so earlier fixes count ("EC 2"
  // has become "EC2" by the time a fix needing EC2 is looked at)
  return fixes.reduce(
    (t, f) => (f.when && !f.when.test(t) ? t : t.replace(f.from, f.to)),
    englishOnly(text)
  )
}
