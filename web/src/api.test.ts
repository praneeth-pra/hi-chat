import { describe, expect, it, vi } from 'vitest';

import { readReplyStream } from './api';

const streamOf = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      }
    })
  );

describe('readReplyStream', () => {
  it('dispatches events split across chunks', async () => {
    const handlers = { onUser: vi.fn(), onDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    await readReplyStream(
      streamOf([
        'event: user\ndata: {"id":"u1"}\n\nevent: del',
        'ta\ndata: {"text":"Hel"}\n\nevent: delta\ndata: {"text":"lo"}\n\n',
        'event: done\ndata: {"message":{"id":"a1"}}\n\n'
      ]),
      handlers
    );
    expect(handlers.onUser).toHaveBeenCalledWith({ id: 'u1' });
    expect(handlers.onDelta.mock.calls.map((c) => c[0])).toEqual(['Hel', 'lo']);
    expect(handlers.onDone).toHaveBeenCalledWith({ id: 'a1' });
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('reports HTTP errors', async () => {
    const handlers = { onDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    await readReplyStream(Response.json({ error: 'Message is empty' }, { status: 400 }), handlers);
    expect(handlers.onError).toHaveBeenCalledWith('Message is empty', null);
  });
});
