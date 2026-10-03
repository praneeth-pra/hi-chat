import { describe, expect, it } from 'vitest';

import { createOpenAiCompatibleClient, LlmError, parseDelta } from './llm.js';

const sseResponse = (lines: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        // Split mid-line to exercise buffering across chunks.
        const text = lines.join('\n') + '\n';
        controller.enqueue(encoder.encode(text.slice(0, 15)));
        controller.enqueue(encoder.encode(text.slice(15)));
        controller.close();
      }
    }),
    { status: 200 }
  );

const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`;

describe('createOpenAiCompatibleClient', () => {
  it('streams content deltas until [DONE]', async () => {
    let request: { url: string; body: string } | null = null;
    const client = createOpenAiCompatibleClient('https://api.example.com/v1/', 'key', (async (
      url: string,
      init: RequestInit
    ) => {
      request = { url, body: init.body as string };
      return sseResponse([chunk('Hel'), '', chunk('lo'), 'data: [DONE]', chunk('ignored')]);
    }) as typeof fetch);

    const parts: string[] = [];
    for await (const part of client.streamChat('m', [{ role: 'user', content: 'hi' }])) {
      parts.push(part);
    }
    expect(parts).toEqual(['Hel', 'lo']);
    expect(request!.url).toBe('https://api.example.com/v1/chat/completions');
    expect(JSON.parse(request!.body)).toMatchObject({ model: 'm', stream: true });
  });

  it('surfaces upstream error messages', async () => {
    const client = createOpenAiCompatibleClient(
      'https://x/v1',
      'bad',
      (async () =>
        new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), {
          status: 401
        })) as typeof fetch
    );
    await expect(client.listModels()).rejects.toMatchObject({
      message: 'Invalid API Key',
      status: 401
    });
  });

  it('lists active models sorted', async () => {
    const client = createOpenAiCompatibleClient('https://x/v1', 'k', (async () =>
      Response.json({
        data: [{ id: 'b' }, { id: 'a' }, { id: 'old', active: false }]
      })) as typeof fetch);
    expect(await client.listModels()).toEqual(['a', 'b']);
  });
});

describe('parseDelta', () => {
  it('ignores malformed events and throws on stream errors', () => {
    expect(parseDelta('not json')).toBeNull();
    expect(parseDelta('{"choices":[{"delta":{}}]}')).toBeNull();
    expect(() => parseDelta('{"error":{"message":"boom"}}')).toThrow(LlmError);
  });
});
