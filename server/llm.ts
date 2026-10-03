export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmClient {
  listModels(): Promise<string[]>;
  /** Yields content deltas as they arrive. Abort with `signal`. */
  streamChat(model: string, messages: ChatTurn[], signal?: AbortSignal): AsyncIterable<string>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** Client for any OpenAI-compatible API (Groq, OpenAI, OpenRouter, ...). */
export function createOpenAiCompatibleClient(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): LlmClient {
  const root = baseUrl.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  const fail = async (res: Response): Promise<never> => {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? detail;
    } catch {
      // keep statusText
    }
    throw new LlmError(detail || `Upstream error ${res.status}`, res.status);
  };

  return {
    async listModels() {
      const res = await fetchImpl(`${root}/models`, { headers });
      if (!res.ok) await fail(res);
      const body = (await res.json()) as { data?: { id: string; active?: boolean }[] };
      return (body.data ?? [])
        .filter((m) => m.active !== false)
        .map((m) => m.id)
        .sort();
    },

    async *streamChat(model, messages, signal) {
      const res = await fetchImpl(`${root}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, stream: true }),
        signal
      });
      if (!res.ok) await fail(res);
      if (!res.body) throw new LlmError('Upstream returned no body', 502);

      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          const delta = parseDelta(data);
          if (delta) yield delta;
        }
      }
    }
  };
}

export function parseDelta(data: string): string | null {
  try {
    const event = JSON.parse(data) as {
      choices?: { delta?: { content?: string | null } }[];
      error?: { message?: string };
    };
    if (event.error) throw new LlmError(event.error.message ?? 'Upstream stream error', 502);
    return event.choices?.[0]?.delta?.content || null;
  } catch (err) {
    if (err instanceof LlmError) throw err;
    return null;
  }
}
