import { describe, expect, it } from 'vitest'
import { oldChats } from '../chatRetention'

const DAY = 24 * 60 * 60
const now = 100 * DAY
const chat = (id: string, daysAgo: number, extra: Partial<Thread> = {}) =>
  ({ id, title: id, updated: now - daysAgo * DAY, ...extra }) as Thread

describe('oldChats', () => {
  const threads = [
    chat('fresh', 1),
    chat('old', 8),
    chat('starred', 30, { isFavorite: true }),
    chat('open', 30),
    chat('undated', 0, { updated: 0 }),
  ]

  it('picks chats older than the limit, keeping favourites and the open chat', () => {
    expect(oldChats(threads, 7, 'open', now)).toEqual(['old'])
  })

  it('keeps everything when turned off', () => {
    expect(oldChats(threads, 0, undefined, now)).toEqual([])
  })

  it('uses the chosen number of days', () => {
    expect(oldChats(threads, 30, undefined, now)).toEqual([])
    expect(oldChats(threads, 5, undefined, now)).toEqual(['old', 'open'])
  })
})
