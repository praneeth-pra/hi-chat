import { describe, it, expect } from 'vitest'
import {
  dateGroupOf,
  firstUserText,
  formatRelativeTime,
  groupThreadsByDate,
  isLikelyJunkChat,
  isPlaceholderTitle,
  looksLikeRequest,
  titleFromMessage,
} from '../chatList'

describe('titleFromMessage', () => {
  it('trims and keeps short text as is', () => {
    expect(titleFromMessage('  What is RAG?  ')).toBe('What is RAG?')
  })

  it('collapses newlines and spaces into one line', () => {
    expect(titleFromMessage('first line\n\nsecond   line')).toBe(
      'first line second line'
    )
  })

  it('cuts long text at a word boundary with an ellipsis', () => {
    const text =
      'Can you explain how the transformer attention mechanism works in large language models'
    const title = titleFromMessage(text)
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(61)
    expect(text.startsWith(title.slice(0, -1))).toBe(true)
    expect(text.charAt(title.length - 1)).toBe(' ')
  })

  it('hard cuts a single very long word', () => {
    const title = titleFromMessage('a'.repeat(100))
    expect(title).toBe(`${'a'.repeat(60)}…`)
  })

  it('returns an empty string for empty input', () => {
    expect(titleFromMessage('')).toBe('')
    expect(titleFromMessage(undefined)).toBe('')
  })
})

describe('isPlaceholderTitle', () => {
  it('matches empty and placeholder titles', () => {
    expect(isPlaceholderTitle('')).toBe(true)
    expect(isPlaceholderTitle(undefined)).toBe(true)
    expect(isPlaceholderTitle('New Thread')).toBe(true)
    expect(isPlaceholderTitle(' new thread ')).toBe(true)
  })

  it('does not match real titles', () => {
    expect(isPlaceholderTitle('Trip to Rome')).toBe(false)
  })
})

describe('date groups', () => {
  // Saturday 4 Oct 2026, 15:00 local time
  const now = new Date(2026, 9, 4, 15, 0, 0).getTime()
  const at = (d: number, h = 12) => new Date(2026, 9, d, h).getTime() / 1000

  it('puts each time in the right group', () => {
    expect(dateGroupOf(at(4, 1), now)).toBe('today')
    expect(dateGroupOf(at(3, 23), now)).toBe('yesterday')
    expect(dateGroupOf(at(3, 0), now)).toBe('yesterday')
    expect(dateGroupOf(at(1), now)).toBe('previous7Days')
    expect(dateGroupOf(new Date(2026, 8, 20).getTime() / 1000, now)).toBe(
      'earlier'
    )
  })

  it('accepts millisecond timestamps', () => {
    expect(dateGroupOf(new Date(2026, 9, 4, 9).getTime(), now)).toBe('today')
  })

  it('groups and sorts threads, skipping empty groups', () => {
    const threads = [
      { id: 'a', updated: at(1) },
      { id: 'b', updated: at(4, 9) },
      { id: 'c', updated: at(4, 14) },
      { id: 'd', updated: new Date(2025, 0, 1).getTime() / 1000 },
    ]
    const groups = groupThreadsByDate(threads, now)
    expect(groups.map((g) => g.label)).toEqual([
      'Today',
      'Previous 7 days',
      'Earlier',
    ])
    expect(groups[0].threads.map((t) => t.id)).toEqual(['c', 'b'])
  })
})

describe('formatRelativeTime', () => {
  const now = new Date(2026, 9, 4, 15, 0, 0).getTime()
  it('formats recent and old times compactly', () => {
    expect(formatRelativeTime(now / 1000, now)).toBe('now')
    expect(formatRelativeTime((now - 5 * 60000) / 1000, now)).toBe('5m')
    expect(formatRelativeTime((now - 3 * 3600000) / 1000, now)).toBe('3h')
    expect(formatRelativeTime((now - 2 * 86400000) / 1000, now)).toBe('2d')
    expect(
      formatRelativeTime(new Date(2026, 8, 12).getTime() / 1000, now)
    ).toBe('Sep 12')
    expect(
      formatRelativeTime(new Date(2024, 8, 12).getTime() / 1000, now)
    ).toBe('Sep 12, 2024')
  })
})

describe('looksLikeRequest', () => {
  it('rejects junk', () => {
    for (const text of [
      'rgawerg',
      'eat',
      'hi',
      'test',
      'Hello!',
      '',
      '   ',
      'ok thanks',
    ]) {
      expect(looksLikeRequest(text)).toBe(false)
    }
  })

  it('rejects keyboard mashing even when long', () => {
    expect(looksLikeRequest('sdfghjkl qwrtzp dfgh xcvbnm')).toBe(false)
  })

  it('accepts real questions and requests', () => {
    for (const text of [
      'What is retrieval augmented generation?',
      'what is RAG?',
      'Explain closures',
      'Write a haiku about autumn leaves',
      'My laptop keeps restarting after the update',
    ]) {
      expect(looksLikeRequest(text)).toBe(true)
    }
  })
})

describe('isLikelyJunkChat', () => {
  it('flags short chats with junk text', () => {
    expect(
      isLikelyJunkChat({ messageCount: 2, firstUserText: 'rgawerg' })
    ).toBe(true)
    expect(isLikelyJunkChat({ messageCount: 1, firstUserText: 'eat' })).toBe(
      true
    )
    expect(isLikelyJunkChat({ messageCount: 0, firstUserText: '' })).toBe(true)
  })

  it('keeps chats with real questions', () => {
    expect(
      isLikelyJunkChat({
        messageCount: 2,
        firstUserText: 'How do I reset my router password?',
      })
    ).toBe(false)
  })

  it('keeps longer conversations even with junk openers', () => {
    expect(isLikelyJunkChat({ messageCount: 3, firstUserText: 'hi' })).toBe(
      false
    )
  })

  it('never flags favourites', () => {
    expect(
      isLikelyJunkChat({
        messageCount: 1,
        firstUserText: 'hi',
        isFavorite: true,
      })
    ).toBe(false)
  })

  it('never flags chats the user renamed', () => {
    expect(
      isLikelyJunkChat({ messageCount: 1, firstUserText: 'ok', renamed: true })
    ).toBe(false)
  })
})

describe('firstUserText', () => {
  it('returns the first user message text', () => {
    expect(
      firstUserText([
        { role: 'assistant', content: [{ text: { value: 'Hello!' } }] },
        { role: 'user', content: [{ text: { value: ' What is RAG? ' } }] },
        { role: 'user', content: [{ text: { value: 'second' } }] },
      ])
    ).toBe('What is RAG?')
  })

  it('returns an empty string when there is none', () => {
    expect(firstUserText([])).toBe('')
  })
})
