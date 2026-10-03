import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { Store } from './db.js';

let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('Store', () => {
  it('adds the instructions column to databases created before it existed', () => {
    dir = mkdtempSync(join(tmpdir(), 'hi-chat-'));
    const path = join(dir, 'chat.db');
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE chats (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`);
    old.prepare('INSERT INTO chats VALUES (?, ?, ?, ?, ?)').run('c1', 'Old', null, 1, 1);
    old.close();

    const store = new Store(path);
    expect(store.getChat('c1')).toMatchObject({ title: 'Old', instructions: '' });
    expect(store.updateChat('c1', { instructions: 'Be kind.' })?.instructions).toBe('Be kind.');
    store.close();
  });
});
