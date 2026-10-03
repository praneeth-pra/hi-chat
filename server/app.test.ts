import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp, titleFrom, NEW_CHAT_TITLE } from './app.js';
import { Store } from './db.js';
import { LlmError, type ChatTurn, type LlmClient } from './llm.js';

class FakeLlm implements LlmClient {
  calls: { model: string; messages: ChatTurn[] }[] = [];
  reply: string[] = ['Hello', ', world'];
  failAfter: number | null = null;

  async listModels() {
    return ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b'];
  }

  async *streamChat(model: string, messages: ChatTurn[]) {
    this.calls.push({ model, messages });
    for (const [i, part] of this.reply.entries()) {
      if (this.failAfter === i) throw new LlmError('rate limited', 429);
      yield part;
    }
  }
}

const parseSse = (text: string) =>
  text
    .trim()
    .split('\n\n')
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1];
      const data = /^data: (.*)$/m.exec(block)?.[1];
      return { event, data: data ? JSON.parse(data) : null };
    });

let store: Store;
let llm: FakeLlm;

const make = (password?: string) =>
  createApp(store, llm, {
    password,
    sessionSecret: 'test-secret',
    defaultModel: 'llama-3.3-70b-versatile',
    secureCookies: false
  });

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

beforeEach(() => {
  store = new Store(':memory:');
  llm = new FakeLlm();
});

afterEach(() => store.close());

describe('titleFrom', () => {
  it('uses the first message, collapsed to one line and capped', () => {
    expect(titleFrom('  what is\n aws   lambda ')).toBe('what is aws lambda');
    expect(titleFrom('x'.repeat(100))).toHaveLength(60);
    expect(titleFrom('   ')).toBe(NEW_CHAT_TITLE);
  });
});

describe('auth', () => {
  it('rejects API calls without a session when a password is set', async () => {
    const app = make('hunter2');
    expect((await app.request('/api/chats')).status).toBe(401);
    expect((await app.request('/api/health')).status).toBe(200);
  });

  it('logs in with the right password and sets a session cookie', async () => {
    const app = make('hunter2');
    const bad = await app.request('/api/login', json({ password: 'nope' }));
    expect(bad.status).toBe(401);

    const good = await app.request('/api/login', json({ password: 'hunter2' }));
    expect(good.status).toBe(200);
    const cookie = good.headers.get('set-cookie')!.split(';')[0];
    expect(cookie).toMatch(/^hc_session=/);

    const res = await app.request('/api/chats', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });

  it('runs open when no password is configured', async () => {
    const res = await make().request('/api/session');
    expect(await res.json()).toEqual({ authRequired: false, authenticated: true });
  });
});

describe('chats', () => {
  it('creates, renames, lists and deletes chats', async () => {
    const app = make();
    const created = await (await app.request('/api/chats', json({}))).json();
    expect(created).toMatchObject({ title: NEW_CHAT_TITLE, model: 'llama-3.3-70b-versatile' });

    const renamed = await app.request(`/api/chats/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Lambda notes' })
    });
    expect((await renamed.json()).title).toBe('Lambda notes');

    expect(await (await app.request('/api/chats')).json()).toHaveLength(1);
    expect((await app.request(`/api/chats/${created.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await (await app.request('/api/chats')).json()).toHaveLength(0);
  });

  it('streams a reply, saves both messages and titles the chat', async () => {
    const app = make();
    const chat = await (await app.request('/api/chats', json({}))).json();

    const res = await app.request(
      `/api/chats/${chat.id}/messages`,
      json({ content: 'what is aws lambda', model: 'openai/gpt-oss-20b' })
    );
    const events = parseSse(await res.text());
    expect(events.map((e) => e.event)).toEqual(['user', 'delta', 'delta', 'done']);
    expect(events[3].data.message.content).toBe('Hello, world');

    expect(llm.calls[0].model).toBe('openai/gpt-oss-20b');
    expect(llm.calls[0].messages).toEqual([{ role: 'user', content: 'what is aws lambda' }]);

    const messages = await (await app.request(`/api/chats/${chat.id}/messages`)).json();
    expect(messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);

    const [saved] = await (await app.request('/api/chats')).json();
    expect(saved).toMatchObject({ title: 'what is aws lambda', model: 'openai/gpt-oss-20b' });
  });

  it('prepends the system prompt from settings', async () => {
    const app = make();
    await app.request('/api/settings', { ...json({ systemPrompt: 'Be brief.' }), method: 'PUT' });
    const chat = await (await app.request('/api/chats', json({}))).json();
    await (await app.request(`/api/chats/${chat.id}/messages`, json({ content: 'hi' }))).text();
    expect(llm.calls[0].messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
  });

  it('reports upstream errors and keeps the partial reply', async () => {
    const app = make();
    llm.failAfter = 1;
    const chat = await (await app.request('/api/chats', json({}))).json();
    const events = parseSse(
      await (await app.request(`/api/chats/${chat.id}/messages`, json({ content: 'hi' }))).text()
    );
    const last = events.at(-1)!;
    expect(last.event).toBe('error');
    expect(last.data.message).toBe('rate limited');
    expect(last.data.partial.content).toBe('Hello');
  });

  it('regenerates by replacing the last assistant reply', async () => {
    const app = make();
    const chat = await (await app.request('/api/chats', json({}))).json();
    await (await app.request(`/api/chats/${chat.id}/messages`, json({ content: 'hi' }))).text();

    llm.reply = ['Second try'];
    await (await app.request(`/api/chats/${chat.id}/regenerate`, json({}))).text();

    const messages = await (await app.request(`/api/chats/${chat.id}/messages`)).json();
    expect(messages.map((m: { content: string }) => m.content)).toEqual(['hi', 'Second try']);
    expect(llm.calls[1].messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('rejects empty messages and unknown chats', async () => {
    const app = make();
    const chat = await (await app.request('/api/chats', json({}))).json();
    expect(
      (await app.request(`/api/chats/${chat.id}/messages`, json({ content: ' ' }))).status
    ).toBe(400);
    expect((await app.request('/api/chats/nope/messages', json({ content: 'hi' }))).status).toBe(
      404
    );
  });
});

describe('models', () => {
  it('lists upstream models with the default', async () => {
    const body = await (await make().request('/api/models')).json();
    expect(body).toEqual({
      models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b'],
      defaultModel: 'llama-3.3-70b-versatile'
    });
  });
});
