import { describe, expect, it } from 'vitest';

import { groupChats } from './Sidebar';

const at = (iso: string) => new Date(iso).getTime();
const chat = (id: string, updatedAt: number) => ({
  id,
  title: id,
  model: null,
  instructions: '',
  createdAt: updatedAt,
  updatedAt
});

describe('groupChats', () => {
  it('buckets chats by recency', () => {
    const now = at('2026-10-03T15:00:00');
    const groups = groupChats(
      [
        chat('today', at('2026-10-03T09:00:00')),
        chat('yesterday', at('2026-10-02T20:00:00')),
        chat('week', at('2026-09-29T10:00:00')),
        chat('old', at('2026-08-01T10:00:00'))
      ],
      now
    );
    expect(groups.map((g) => [g.label, g.chats.map((c) => c.id)])).toEqual([
      ['Today', ['today']],
      ['Yesterday', ['yesterday']],
      ['Previous 7 days', ['week']],
      ['Older', ['old']]
    ]);
  });
});
