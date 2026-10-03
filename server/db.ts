import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type Role = 'system' | 'user' | 'assistant';

export interface Chat {
  id: string;
  title: string;
  model: string | null;
  instructions: string;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  chatId: string;
  role: Role;
  content: string;
  model: string | null;
  createdAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_chat_seq ON messages(chat_id, seq);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

const toChat = (r: Row): Chat => ({
  id: r.id as string,
  title: r.title as string,
  model: (r.model as string | null) ?? null,
  instructions: (r.instructions as string | null) ?? '',
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at)
});

const toMessage = (r: Row): Message => ({
  id: r.id as string,
  chatId: r.chat_id as string,
  role: r.role as Role,
  content: r.content as string,
  model: (r.model as string | null) ?? null,
  createdAt: Number(r.created_at)
});

export class Store {
  private db: DatabaseSync;
  private clock: () => number;

  constructor(path: string, clock: () => number = Date.now) {
    this.db = new DatabaseSync(path);
    this.clock = clock;
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  private migrate() {
    const columns = this.db.prepare('PRAGMA table_info(chats)').all() as Row[];
    if (!columns.some((c) => c.name === 'instructions')) {
      this.db.exec("ALTER TABLE chats ADD COLUMN instructions TEXT NOT NULL DEFAULT ''");
    }
  }

  close() {
    this.db.close();
  }

  listChats(): Chat[] {
    return this.db
      .prepare('SELECT * FROM chats ORDER BY updated_at DESC')
      .all()
      .map((r) => toChat(r as Row));
  }

  getChat(id: string): Chat | null {
    const r = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id);
    return r ? toChat(r as Row) : null;
  }

  createChat(title: string, model: string | null, instructions = ''): Chat {
    const now = this.clock();
    const chat: Chat = {
      id: randomUUID(),
      title,
      model,
      instructions,
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        'INSERT INTO chats (id, title, model, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(chat.id, chat.title, chat.model, instructions, now, now);
    return chat;
  }

  updateChat(
    id: string,
    patch: { title?: string; model?: string | null; instructions?: string }
  ): Chat | null {
    const chat = this.getChat(id);
    if (!chat) return null;
    const next = { ...chat, ...patch, updatedAt: this.clock() };
    this.db
      .prepare(
        'UPDATE chats SET title = ?, model = ?, instructions = ?, updated_at = ? WHERE id = ?'
      )
      .run(next.title, next.model, next.instructions, next.updatedAt, id);
    return next;
  }

  deleteChat(id: string): boolean {
    return this.db.prepare('DELETE FROM chats WHERE id = ?').run(id).changes > 0;
  }

  listMessages(chatId: string): Message[] {
    return this.db
      .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY seq ASC')
      .all(chatId)
      .map((r) => toMessage(r as Row));
  }

  addMessage(chatId: string, role: Role, content: string, model: string | null = null): Message {
    const now = this.clock();
    const seqRow = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE chat_id = ?')
      .get(chatId) as Row;
    const message: Message = { id: randomUUID(), chatId, role, content, model, createdAt: now };
    this.db
      .prepare(
        'INSERT INTO messages (id, chat_id, role, content, model, created_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(message.id, chatId, role, content, model, now, Number(seqRow.next));
    this.db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(now, chatId);
    return message;
  }

  /** Deletes a message and every message after it in the same chat. */
  truncateFrom(chatId: string, messageId: string): number {
    const row = this.db
      .prepare('SELECT seq FROM messages WHERE chat_id = ? AND id = ?')
      .get(chatId, messageId) as Row | undefined;
    if (!row) return 0;
    return Number(
      this.db
        .prepare('DELETE FROM messages WHERE chat_id = ? AND seq >= ?')
        .run(chatId, Number(row.seq)).changes
    );
  }

  getSetting(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      Row | undefined;
    return r ? (r.value as string) : null;
  }

  setSetting(key: string, value: string) {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value);
  }
}
