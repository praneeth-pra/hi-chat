import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Chat, Store } from './db.js';
import { LlmError, type ChatTurn, type LlmClient } from './llm.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
  passwordMatches,
  verifySessionToken
} from './auth.js';

export interface AppConfig {
  /** When unset, the app runs without a login (local development only). */
  password?: string;
  sessionSecret: string;
  defaultModel: string;
  secureCookies: boolean;
  /** Directory with the built web app; omitted in tests. */
  webRoot?: string;
}

export const NEW_CHAT_TITLE = 'New chat';
const MAX_TITLE = 60;

export function titleFrom(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  if (!oneLine) return NEW_CHAT_TITLE;
  return oneLine.length > MAX_TITLE ? `${oneLine.slice(0, MAX_TITLE - 1)}…` : oneLine;
}

export function createApp(store: Store, llm: LlmClient, config: AppConfig) {
  const app = new Hono();
  const authRequired = Boolean(config.password);

  const isAuthed = (c: Context) =>
    !authRequired || verifySessionToken(config.sessionSecret, getCookie(c, SESSION_COOKIE));

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/session', (c) => c.json({ authRequired, authenticated: isAuthed(c) }));

  app.post('/api/login', async (c) => {
    if (!authRequired) return c.json({ ok: true });
    const body = await c.req.json().catch(() => ({}));
    if (!passwordMatches(config.password!, (body as { password?: unknown }).password)) {
      // Slow down guessing.
      await new Promise((r) => setTimeout(r, 400));
      return c.json({ error: 'Wrong password' }, 401);
    }
    setCookie(c, SESSION_COOKIE, createSessionToken(config.sessionSecret), {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'Lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000)
    });
    return c.json({ ok: true });
  });

  app.post('/api/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.use('/api/*', async (c, next) => {
    if (!isAuthed(c)) return c.json({ error: 'Not signed in' }, 401);
    await next();
  });

  const defaultModel = () => store.getSetting('defaultModel') || config.defaultModel;

  app.get('/api/models', async (c) => {
    try {
      return c.json({ models: await llm.listModels(), defaultModel: defaultModel() });
    } catch (err) {
      const status = err instanceof LlmError ? err.status : 502;
      return c.json({ error: `Could not load models: ${(err as Error).message}`, status }, 502);
    }
  });

  app.get('/api/settings', (c) =>
    c.json({ defaultModel: defaultModel(), systemPrompt: store.getSetting('systemPrompt') ?? '' })
  );

  app.put('/api/settings', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.defaultModel === 'string' && body.defaultModel.trim()) {
      store.setSetting('defaultModel', body.defaultModel.trim());
    }
    if (typeof body.systemPrompt === 'string') {
      store.setSetting('systemPrompt', body.systemPrompt);
    }
    return c.json({
      defaultModel: defaultModel(),
      systemPrompt: store.getSetting('systemPrompt') ?? ''
    });
  });

  app.get('/api/chats', (c) => c.json(store.listChats()));

  app.post('/api/chats', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { model?: unknown };
    const model = typeof body.model === 'string' && body.model ? body.model : defaultModel();
    return c.json(store.createChat(NEW_CHAT_TITLE, model), 201);
  });

  app.patch('/api/chats/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { title?: unknown; model?: unknown };
    const patch: { title?: string; model?: string } = {};
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
    if (typeof body.model === 'string' && body.model) patch.model = body.model;
    const chat = store.updateChat(c.req.param('id'), patch);
    return chat ? c.json(chat) : c.json({ error: 'Chat not found' }, 404);
  });

  app.delete('/api/chats/:id', (c) =>
    store.deleteChat(c.req.param('id'))
      ? c.body(null, 204)
      : c.json({ error: 'Chat not found' }, 404)
  );

  app.get('/api/chats/:id/messages', (c) => {
    const chat = store.getChat(c.req.param('id'));
    return chat ? c.json(store.listMessages(chat.id)) : c.json({ error: 'Chat not found' }, 404);
  });

  /** Streams an assistant reply to the chat's current history as server-sent events. */
  const streamReply = (c: Context, chat: Chat, model: string, userMessage?: unknown) =>
    streamSSE(c, async (stream) => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());

      if (userMessage) await stream.writeSSE({ event: 'user', data: JSON.stringify(userMessage) });

      const systemPrompt = store.getSetting('systemPrompt')?.trim();
      const history: ChatTurn[] = store
        .listMessages(chat.id)
        .map(({ role, content }) => ({ role, content }));
      if (systemPrompt) history.unshift({ role: 'system', content: systemPrompt });

      let text = '';
      let errorMessage: string | null = null;
      try {
        for await (const delta of llm.streamChat(model, history, controller.signal)) {
          text += delta;
          await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: delta }) });
        }
      } catch (err) {
        if (!controller.signal.aborted) errorMessage = (err as Error).message || 'Request failed';
      }

      const saved = text ? store.addMessage(chat.id, 'assistant', text, model) : null;
      if (errorMessage) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: errorMessage, partial: saved })
        });
      } else if (!controller.signal.aborted) {
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ message: saved }) });
      }
    });

  const pickModel = (chat: Chat, requested: unknown) =>
    typeof requested === 'string' && requested ? requested : chat.model || defaultModel();

  app.post('/api/chats/:id/messages', async (c) => {
    let chat = store.getChat(c.req.param('id'));
    if (!chat) return c.json({ error: 'Chat not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { content?: unknown; model?: unknown };
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return c.json({ error: 'Message is empty' }, 400);

    const model = pickModel(chat, body.model);
    const isFirst = store.listMessages(chat.id).length === 0;
    chat =
      store.updateChat(chat.id, {
        model,
        ...(isFirst && chat.title === NEW_CHAT_TITLE ? { title: titleFrom(content) } : {})
      }) ?? chat;
    const userMessage = store.addMessage(chat.id, 'user', content);
    return streamReply(c, chat, model, userMessage);
  });

  app.post('/api/chats/:id/regenerate', async (c) => {
    const chat = store.getChat(c.req.param('id'));
    if (!chat) return c.json({ error: 'Chat not found' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { model?: unknown };
    const messages = store.listMessages(chat.id);
    const last = messages.at(-1);
    if (!last) return c.json({ error: 'Nothing to regenerate' }, 400);
    if (last.role === 'assistant') store.truncateFrom(chat.id, last.id);
    const model = pickModel(chat, body.model);
    store.updateChat(chat.id, { model });
    return streamReply(c, chat, model);
  });

  app.delete('/api/chats/:id/messages/:messageId', (c) => {
    const removed = store.truncateFrom(c.req.param('id'), c.req.param('messageId'));
    return removed ? c.body(null, 204) : c.json({ error: 'Message not found' }, 404);
  });

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  if (config.webRoot && existsSync(join(config.webRoot, 'index.html'))) {
    const indexHtml = readFileSync(join(config.webRoot, 'index.html'), 'utf8');
    app.use('/assets/*', async (c, next) => {
      await next();
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
    });
    app.use('/*', serveStatic({ root: config.webRoot }));
    app.get('*', (c) => c.html(indexHtml));
  }

  return app;
}
