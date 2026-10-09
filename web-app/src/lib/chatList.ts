/**
 * Pure helpers for the chat list: titles, date groups, relative times and
 * the "likely junk" heuristic used by the Clean up dialog.
 */

export const PLACEHOLDER_TITLES = ['new thread', 'new chat']

const DEFAULT_TITLE_LENGTH = 60

/** Strips the highlight spans search adds to titles. */
export function plainTitle(title?: string | null): string {
  return (title || '').replace(/<span[^>]*>|<\/span>/g, '').trim()
}

/** True when a title is empty or one of the app's placeholder titles. */
export function isPlaceholderTitle(title?: string | null): boolean {
  const plain = plainTitle(title).toLowerCase()
  return plain === '' || PLACEHOLDER_TITLES.includes(plain)
}

/**
 * Turns the first message of a chat into a title: one line, trimmed and cut
 * at a word boundary with an ellipsis when it is longer than `maxLength`.
 */
export function titleFromMessage(
  text?: string | null,
  maxLength = DEFAULT_TITLE_LENGTH
): string {
  const line = (text || '').replace(/\s+/g, ' ').trim()
  if (line.length <= maxLength) return line
  const cut = line.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(' ')
  // Only back up to a word boundary when it keeps most of the text.
  const base = lastSpace > maxLength * 0.5 ? cut.slice(0, lastSpace) : cut
  return `${base.replace(/[\s,.;:!?-]+$/, '')}…`
}

export type DateGroupKey = 'today' | 'yesterday' | 'previous7Days' | 'earlier'

export const DATE_GROUP_LABELS: Record<DateGroupKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  previous7Days: 'Previous 7 days',
  earlier: 'Earlier',
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Thread `updated` values are in seconds; tolerate milliseconds too. */
export function toMillis(timestamp?: number | null): number {
  if (!timestamp) return 0
  return timestamp > 1e12 ? timestamp : timestamp * 1000
}

function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function dateGroupOf(timestamp: number, now = Date.now()): DateGroupKey {
  const ms = toMillis(timestamp)
  const today = startOfDay(now)
  if (ms >= today) return 'today'
  if (ms >= today - DAY_MS) return 'yesterday'
  if (ms >= today - 7 * DAY_MS) return 'previous7Days'
  return 'earlier'
}

/**
 * Groups threads into Today, Yesterday, Previous 7 days and Earlier, newest
 * first within each group. Empty groups are left out.
 */
export function groupThreadsByDate<T extends { updated: number }>(
  threads: T[],
  now = Date.now()
): { key: DateGroupKey; label: string; threads: T[] }[] {
  const order: DateGroupKey[] = [
    'today',
    'yesterday',
    'previous7Days',
    'earlier',
  ]
  const buckets: Record<DateGroupKey, T[]> = {
    today: [],
    yesterday: [],
    previous7Days: [],
    earlier: [],
  }
  const sorted = [...threads].sort(
    (a, b) => toMillis(b.updated) - toMillis(a.updated)
  )
  for (const thread of sorted) {
    buckets[dateGroupOf(thread.updated, now)].push(thread)
  }
  return order
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({
      key,
      label: DATE_GROUP_LABELS[key],
      threads: buckets[key],
    }))
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** Compact relative time: "now", "5m", "3h", "2d", "Sep 12", "Sep 12, 2024". */
export function formatRelativeTime(
  timestamp: number,
  now = Date.now()
): string {
  const ms = toMillis(timestamp)
  const diff = Math.max(0, now - ms)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const date = new Date(ms)
  const label = `${MONTHS[date.getMonth()]} ${date.getDate()}`
  return date.getFullYear() === new Date(now).getFullYear()
    ? label
    : `${label}, ${date.getFullYear()}`
}

/** Readable date for the Clean up dialog, e.g. "Sep 12, 2026". */
export function formatShortDate(timestamp: number): string {
  const date = new Date(toMillis(timestamp))
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

const FILLER = new Set([
  'hi',
  'hii',
  'hello',
  'hey',
  'heya',
  'yo',
  'sup',
  'test',
  'testing',
  'test test',
  'ok',
  'okay',
  'k',
  'thanks',
  'thank you',
  'thx',
  'ty',
  'hmm',
  'hm',
  'lol',
  'yes',
  'no',
  'asdf',
  'qwerty',
  'hello world',
  'hi there',
  'hello there',
])

const QUESTION_WORDS = new Set([
  'what',
  'whats',
  "what's",
  'why',
  'how',
  'when',
  'where',
  'who',
  'which',
  'whose',
  'can',
  'could',
  'should',
  'would',
  'is',
  'are',
  'do',
  'does',
  'did',
  'will',
  'explain',
  'define',
  'describe',
  'tell',
  'write',
  'give',
  'list',
  'compare',
  'summarize',
  'summarise',
  'translate',
  'help',
])

const MIN_WORDS = 4

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ''))
    .filter(Boolean)
}

/** A word that looks like keyboard mashing: no vowels or a long consonant run. */
function isGibberishWord(word: string): boolean {
  if (!/^[a-z]+$/.test(word) || word.length < 5) return false
  if (!/[aeiouy]/.test(word)) return true
  return /[bcdfghjklmnpqrstvwxz]{5,}/.test(word)
}

/** True when the text reads like a question or a request to the assistant. */
export function looksLikeRequest(text?: string | null): boolean {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return false
  const list = words(clean)
  if (list.length === 0) return false
  if (FILLER.has(list.join(' '))) return false
  const gibberish = list.filter(isGibberishWord).length
  if (gibberish * 2 >= list.length) return false
  if (list.length >= MIN_WORDS) return true
  // Short, but phrased as a question ("what is RAG?").
  return (
    list.length >= 2 && (clean.endsWith('?') || QUESTION_WORDS.has(list[0]))
  )
}

export type JunkCandidate = {
  /** Number of messages in the chat (user and assistant). */
  messageCount: number
  /** Text of the first user message, if any. */
  firstUserText?: string | null
  isFavorite?: boolean
  /** The user gave the chat its own name, so they mean to keep it. */
  renamed?: boolean
}

/**
 * A chat is likely junk when it is short (at most 2 messages) and the user's
 * text is not a real question or request: "rgawerg", "eat", "hi", "test".
 * Favourited chats and chats the user renamed never are.
 */
export function isLikelyJunkChat(chat: JunkCandidate): boolean {
  if (chat.isFavorite || chat.renamed) return false
  if (chat.messageCount > 2) return false
  return !looksLikeRequest(chat.firstUserText)
}

type MessageLike = {
  role?: string
  content?: { text?: { value?: string } }[]
}

/** Text of the first user message in a list of thread messages. */
export function firstUserText(messages: MessageLike[]): string {
  const first = messages.find((m) => m.role === 'user')
  if (!first) return ''
  return (first.content ?? [])
    .map((c) => c.text?.value ?? '')
    .filter(Boolean)
    .join(' ')
    .trim()
}
