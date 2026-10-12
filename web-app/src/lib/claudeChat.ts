/**
 * Streams a chat reply from Claude (Anthropic's Messages API) in the shape of
 * OpenAI chat completion chunks, so Auto can use Claude like the other chat
 * models. The web build has no built-in Anthropic provider; the key comes
 * from anthropicConfig, the same one the Claude judges use.
 */

type OpenAIMessage = {
  role: string
  content?: unknown
}

type ClaudeMessage = { role: 'user' | 'assistant'; content: string }

export type ClaudeChunk = {
  choices: {
    index: number
    delta: { content?: string }
    finish_reason: string | null
  }[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) =>
      part && typeof part === 'object' && 'text' in part
        ? String((part as { text: unknown }).text ?? '')
        : ''
    )
    .join('')
}

/**
 * OpenAI-style messages to Claude's system prompt and alternating turns.
 * Tool calls and results are left out; same-role turns are merged.
 */
export function toClaudeMessages(messages: OpenAIMessage[]): {
  system: string
  messages: ClaudeMessage[]
} {
  const system: string[] = []
  const turns: ClaudeMessage[] = []
  for (const m of messages) {
    const text = textOf(m.content).trim()
    if (!text) continue
    if (m.role === 'system' || m.role === 'developer') {
      system.push(text)
      continue
    }
    if (m.role !== 'user' && m.role !== 'assistant') continue
    const last = turns[turns.length - 1]
    if (last?.role === m.role) last.content += `\n\n${text}`
    else turns.push({ role: m.role, content: text })
  }
  // Claude's turns must start with the user
  while (turns[0]?.role === 'assistant') turns.shift()
  return { system: system.join('\n\n'), messages: turns }
}

const chunk = (content: string): ClaudeChunk => ({
  choices: [{ index: 0, delta: { content }, finish_reason: null }],
})

export async function streamClaude(opts: {
  apiKey: string
  baseUrl?: string
  model: string
  messages: OpenAIMessage[]
  signal: AbortSignal
  maxTokens?: number
  /** Thinking off (`between_tools` on Sonnet 5.5) and effort low, for speed. */
  fast?: boolean
}): Promise<AsyncIterable<ClaudeChunk>> {
  const { system, messages } = toClaudeMessages(opts.messages)
  const base = (opts.baseUrl || 'https://api.anthropic.com')
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '')
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
      ...(opts.fast
        ? {
            thinking: { type: 'between_tools' },
            output_config: { effort: 'low' },
          }
        : {}),
      ...(system ? { system } : {}),
      messages,
    }),
  })
  if (!res.ok || !res.body) {
    void res.body?.cancel().catch(() => {})
    throw Object.assign(new Error(`Claude ${res.status}`), {
      status: res.status,
    })
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  return (async function* () {
    let buffer = ''
    let input = 0
    let output = 0
    let stopped = false
    let finishReason = 'stop'
    const abort = () => {
      void reader.cancel().catch(() => {})
    }
    opts.signal.addEventListener('abort', abort, { once: true })
    try {
      for (;;) {
        if (opts.signal.aborted) throw opts.signal.reason
        const { done, value } = await reader.read()
        if (opts.signal.aborted) throw opts.signal.reason
        buffer += decoder.decode(value, { stream: !done })
        if (buffer.length > 1_048_576)
          throw new Error('Claude stream frame too large')
        if (done && buffer) buffer += '\n'
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const event = JSON.parse(line.slice(5).trim())
          if (event.type === 'message_start')
            input = event.message?.usage?.input_tokens ?? 0
          else if (
            event.type === 'content_block_delta' &&
            event.delta?.type === 'text_delta'
          )
            yield chunk(event.delta.text)
          else if (event.type === 'message_delta') {
            output = event.usage?.output_tokens ?? output
            if (event.delta?.stop_reason === 'max_tokens')
              finishReason = 'length'
          } else if (event.type === 'message_stop') stopped = true
          else if (event.type === 'error')
            throw new Error('Claude stream failed')
        }
        if (stopped || done) break
      }
      if (!stopped) throw new Error('Claude stream ended before completion')
      yield {
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
        usage: {
          prompt_tokens: input,
          completion_tokens: output,
          total_tokens: input + output,
        },
      }
    } finally {
      opts.signal.removeEventListener('abort', abort)
      void reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  })()
}

/**
 * One non-streaming Claude reply (the Accuracy reviewer). Thinking stays off
 * (`between_tools` on Sonnet 5.5) and effort low, for speed.
 */
export async function completeClaude(opts: {
  apiKey: string
  baseUrl?: string
  model: string
  messages: OpenAIMessage[]
  signal: AbortSignal
  maxTokens?: number
}): Promise<{ text: string; stopReason: string | null }> {
  const { system, messages } = toClaudeMessages(opts.messages)
  const base = (opts.baseUrl || 'https://api.anthropic.com')
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '')
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8192,
      thinking: { type: 'between_tools' },
      output_config: { effort: 'low' },
      ...(system ? { system } : {}),
      messages,
    }),
  })
  if (!res.ok)
    throw Object.assign(new Error(`Claude ${res.status}`), {
      status: res.status,
    })
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[]
    stop_reason?: string | null
  }
  return {
    text: (data.content ?? [])
      .map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
      .join(''),
    stopReason: data.stop_reason ?? null,
  }
}
