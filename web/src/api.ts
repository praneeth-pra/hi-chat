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
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  createdAt: number;
}

export interface Settings {
  defaultModel: string;
  systemPrompt: string;
  /** How many earlier messages each reply sees; 0 means all. */
  contextMessages: number;
  /** Models shown in the picker; empty means all. */
  enabledModels: string[];
}

/** The models to offer in the picker: the enabled ones that still exist, or all of them. */
export const pickerModels = (all: string[], enabled: string[]) => {
  const kept = all.filter((m) => enabled.includes(m));
  return kept.length ? kept : all;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError((body as { error?: string }).error ?? res.statusText, res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body)
});

export const api = {
  session: () => request<{ authRequired: boolean; authenticated: boolean }>('/api/session'),
  login: (password: string) => request('/api/login', send('POST', { password })),
  logout: () => request('/api/logout', send('POST')),
  models: () => request<{ models: string[]; defaultModel: string }>('/api/models'),
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (s: Partial<Settings>) => request<Settings>('/api/settings', send('PUT', s)),
  chats: () => request<Chat[]>('/api/chats'),
  createChat: (model?: string, instructions?: string) =>
    request<Chat>('/api/chats', send('POST', { model, instructions })),
  updateChat: (id: string, patch: { title?: string; model?: string; instructions?: string }) =>
    request<Chat>(`/api/chats/${id}`, send('PATCH', patch)),
  deleteChat: (id: string) => request<void>(`/api/chats/${id}`, send('DELETE')),
  messages: (chatId: string) => request<Message[]>(`/api/chats/${chatId}/messages`),
  deleteFrom: (chatId: string, messageId: string) =>
    request<void>(`/api/chats/${chatId}/messages/${messageId}`, send('DELETE'))
};

export interface StreamHandlers {
  onUser?: (message: Message) => void;
  onDelta: (text: string) => void;
  onDone: (message: Message | null) => void;
  onError: (message: string, partial: Message | null) => void;
}

/** Reads the server-sent events of a reply stream and dispatches them to `handlers`. */
export async function readReplyStream(res: Response, handlers: StreamHandlers) {
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    handlers.onError((body as { error?: string }).error ?? res.statusText, null);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      dispatch(buffer.slice(0, split), handlers);
      buffer = buffer.slice(split + 2);
    }
  }
  if (buffer.trim()) dispatch(buffer, handlers);
}

function dispatch(block: string, handlers: StreamHandlers) {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return;
  const payload = JSON.parse(data.join('\n'));
  if (event === 'user') handlers.onUser?.(payload);
  else if (event === 'delta') handlers.onDelta(payload.text);
  else if (event === 'done') handlers.onDone(payload.message);
  else if (event === 'error') handlers.onError(payload.message, payload.partial ?? null);
}

export function streamMessage(
  chatId: string,
  content: string,
  model: string,
  handlers: StreamHandlers,
  signal: AbortSignal
) {
  return fetch(`/api/chats/${chatId}/messages`, {
    ...send('POST', { content, model }),
    headers: { 'Content-Type': 'application/json' },
    signal
  }).then((res) => readReplyStream(res, handlers));
}

export function streamRegenerate(
  chatId: string,
  model: string,
  handlers: StreamHandlers,
  signal: AbortSignal
) {
  return fetch(`/api/chats/${chatId}/regenerate`, {
    ...send('POST', { model }),
    headers: { 'Content-Type': 'application/json' },
    signal
  }).then((res) => readReplyStream(res, handlers));
}
