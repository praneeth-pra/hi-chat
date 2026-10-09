import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * The chat model and its fallbacks, used when Auto is picked. If a reply's
 * model fails or sends nothing for FIRST_CHUNK_TIMEOUT_MS, the same request
 * goes to the next model in the order, so one answer still arrives.
 */
export type ChatModelKey =
  | 'claude-haiku'
  | 'claude-haiku-5'
  | 'claude-sonnet'
  | 'cerebras-120b'
  | 'groq-120b'
  | 'groq-20b'

export const CHAT_MODELS: {
  value: ChatModelKey
  label: string
  provider: string
  model: string
  /** How long to wait for its first chunk before the next model is used. */
  firstChunkMs?: number
}[] = [
  // Called directly (claudeChat.ts) with the key the Claude judges use
  {
    value: 'claude-haiku',
    label: 'Claude Haiku 4.5',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
  },
  {
    value: 'claude-haiku-5',
    label: 'Claude Haiku 5.5',
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
  },
  // Better answers but slower to start, so it gets longer before Cerebras
  {
    value: 'claude-sonnet',
    label: 'Claude Sonnet 5.5',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    firstChunkMs: 2500,
  },
  {
    value: 'cerebras-120b',
    label: 'Cerebras gpt-oss-120b',
    provider: 'cerebras',
    model: 'gpt-oss-120b',
  },
  {
    value: 'groq-120b',
    label: 'Groq gpt-oss-120b',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
  },
  {
    value: 'groq-20b',
    label: 'Groq gpt-oss-20b',
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
  },
]

export const CHAT_MODEL_STORAGE_KEY = 'chat-model'
export const CHAT_FALLBACK_STORAGE_KEY = 'chat-fallback'

/** No first chunk (reasoning or answer) in this long: try the next model. */
export const FIRST_CHUNK_TIMEOUT_MS = 1500

const isKey = (v: string | null): v is ChatModelKey =>
  CHAT_MODELS.some((m) => m.value === v)

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage blocked: the default stays in effect
  }
}

/**
 * Claude Haiku became the default on 8 Oct 2026, at P's request. A browser
 * that had saved the old default (Cerebras) moves to Claude once; a choice
 * made after that is kept.
 */
const CLAUDE_DEFAULT_KEY = 'chat-model-claude-default'
function moveToClaudeOnce() {
  if (read(CLAUDE_DEFAULT_KEY)) return
  write(CLAUDE_DEFAULT_KEY, 'done')
  if (read(CHAT_MODEL_STORAGE_KEY) === 'cerebras-120b') {
    try {
      localStorage.removeItem(CHAT_MODEL_STORAGE_KEY)
      localStorage.removeItem(CHAT_FALLBACK_STORAGE_KEY)
    } catch {
      // Storage blocked: nothing was saved either
    }
  }
}

export function getChatModel(): ChatModelKey {
  moveToClaudeOnce()
  const saved = read(CHAT_MODEL_STORAGE_KEY)
  return isKey(saved) ? saved : 'claude-haiku'
}

export const setChatModel = (key: ChatModelKey) =>
  write(CHAT_MODEL_STORAGE_KEY, key)

/** The first fallback; never the chat model itself. */
export function getChatFallback(): ChatModelKey {
  const main = getChatModel()
  const saved = read(CHAT_FALLBACK_STORAGE_KEY)
  if (isKey(saved) && saved !== main) return saved
  // Cerebras, the fastest, backs up Claude; otherwise the fastest other one
  if (chatModelInfo(main).provider === 'anthropic') return 'cerebras-120b'
  return main === 'groq-20b' ? 'cerebras-120b' : 'groq-20b'
}

export const setChatFallback = (key: ChatModelKey) =>
  write(CHAT_FALLBACK_STORAGE_KEY, key)

/**
 * Chat model, first fallback, then the rest. At most one Claude model is
 * tried: another Claude would be no faster than the one that just stalled.
 */
export function chatModelOrder(): ChatModelKey[] {
  const order = [getChatModel(), getChatFallback()]
  const isClaude = (v: ChatModelKey) =>
    chatModelInfo(v).provider === 'anthropic'
  for (const { value } of CHAT_MODELS) {
    if (order.includes(value)) continue
    if (isClaude(value) && order.some(isClaude)) continue
    order.push(value)
  }
  return order
}

export const chatModelInfo = (key: ChatModelKey) =>
  CHAT_MODELS.find((m) => m.value === key)!

/** The models Auto tries, in the settings order. */
export const autoChain = (): {
  provider: string
  model: string
  firstChunkMs: number
}[] =>
  chatModelOrder().map((key) => {
    const { provider, model, firstChunkMs } = chatModelInfo(key)
    return {
      provider,
      model,
      firstChunkMs: firstChunkMs ?? FIRST_CHUNK_TIMEOUT_MS,
    }
  })

/**
 * Auto in the model picker: replies go to the chat model and its fallbacks
 * (Settings > General). Picking a model by name turns it off, and that model
 * alone answers. Kept in this browser; on by default.
 */
export const useChatAuto = create<{
  auto: boolean
  setAuto: (auto: boolean) => void
}>()(
  persist(
    (set) => ({
      auto: true,
      setAuto: (auto) => set({ auto }),
    }),
    { name: 'chat-auto', storage: createJSONStorage(() => localStorage) }
  )
)

type Attempt<T> = (controller: AbortController) => Promise<AsyncIterable<T>>

/**
 * Streams the first attempt that sends a chunk within the timeout. An attempt
 * that fails or stays silent is aborted and the next one starts; once a chunk
 * has arrived, later errors are passed on as usual. `onFallback` is told why
 * each skipped attempt was dropped. `timeoutMs` is one wait for every
 * attempt, or one per attempt. With `headStart`, the second attempt
 * starts together with the first, so if the first is slow the second is
 * already under way; whichever isn't used is aborted.
 */
export async function streamWithFallback<T>(
  attempts: Attempt<T>[],
  outer: AbortSignal,
  onFallback: (index: number, why: string) => void,
  timeoutMs: number | number[] = FIRST_CHUNK_TIMEOUT_MS,
  { headStart = false }: { headStart?: boolean } = {}
): Promise<AsyncIterable<T>> {
  type Started = {
    own: AbortController
    stop: () => void
    firstChunk: Promise<{
      iterator: AsyncIterator<T>
      first: IteratorResult<T>
    }>
  }
  const started = new Map<number, Started>()
  const start = (i: number): Started => {
    const own = new AbortController()
    const stop = () => own.abort()
    outer.addEventListener('abort', stop)
    const firstChunk = (async () => {
      const stream = await attempts[i](own)
      const iterator = stream[Symbol.asyncIterator]()
      const first = await iterator.next()
      return { iterator, first }
    })()
    // A dropped attempt may still fail later; that is expected
    firstChunk.catch(() => {})
    const run = { own, stop, firstChunk }
    started.set(i, run)
    return run
  }
  const drop = (i: number) => {
    const run = started.get(i)
    if (!run) return
    outer.removeEventListener('abort', run.stop)
    run.own.abort()
    started.delete(i)
  }

  for (let i = 0; i < attempts.length; i++) {
    const last = i === attempts.length - 1
    const run = started.get(i) ?? start(i)
    if (i === 0 && headStart && !last) start(1)
    let timer: ReturnType<typeof setTimeout> | undefined
    const waitMs = Array.isArray(timeoutMs)
      ? (timeoutMs[i] ?? FIRST_CHUNK_TIMEOUT_MS)
      : timeoutMs
    try {
      const timeout = new Promise<never>((_, reject) => {
        if (!last)
          timer = setTimeout(
            () => reject(new Error(`no reply in ${waitMs / 1000} s`)),
            waitMs
          )
      })
      const { iterator, first } = await Promise.race([run.firstChunk, timeout])
      clearTimeout(timer)
      // The one that answered wins; any other under way is stopped
      for (const other of [...started.keys()]) if (other !== i) drop(other)
      return (async function* () {
        try {
          if (!first.done) yield first.value
          for (;;) {
            const next = await iterator.next()
            if (next.done) return
            yield next.value
          }
        } finally {
          outer.removeEventListener('abort', run.stop)
        }
      })()
    } catch (err) {
      clearTimeout(timer)
      drop(i)
      if (last || outer.aborted) {
        for (const other of [...started.keys()]) drop(other)
        throw err
      }
      onFallback(i, err instanceof Error ? err.message : String(err))
    }
  }
  throw new Error('No model to send to')
}
