import { streamClaude } from './claudeChat'
import { getChatThinking } from './chatThinking'
import { withCodingRule } from './codingAnswer'

/**
 * Real interviewer questions from the speaker logs (Oct 2026), for comparing
 * how well and how fast each chat model answers them.
 */
export const ANSWER_QUESTIONS = [
  'How would you make your subnet a public or a private one?',
  'Suppose I have a private subnet, and my private subnet needs access to the internet, right? So where would be my outgoing rules? In the public subnet or the private subnet route table?',
  'If I have to connect my on-premises network with AWS, can you list down all the choices you have to connect both the networks?',
  'There is also VPC peering in AWS. So why do you think you require a transit gateway and what problem does transit gateway solve?',
  'You mentioned that VPC peering is cheap compared to transit gateway when connecting only two VPCs. Why do you think it is so?',
  'How do you facilitate connectivity to KMS and S3 from a private subnet? What configuration is required to enable that connectivity?',
  'How do you debug issues with your application in AWS?',
  'For an API hosted in AWS, the pod got deleted. Do you know how to bring up the pod again?',
  'Can you tell me some commands, like how do you get the status of pods and how do you start them?',
  'Can you tell me how you implement Jenkins along with your project?',
]

export type AnswerModel =
  | 'claude-haiku'
  | 'claude-haiku-5'
  | 'claude-sonnet'
  | 'cerebras-120b'

export const ANSWER_MODELS: {
  value: AnswerModel
  label: string
  /** Claude's model id; the rest are Cerebras. */
  claude?: string
}[] = [
  {
    value: 'claude-haiku',
    label: 'Claude Haiku 4.5',
    claude: 'claude-haiku-4-5',
  },
  {
    value: 'claude-haiku-5',
    label: 'Claude Haiku 5.5',
    claude: 'claude-haiku-5-5',
  },
  {
    value: 'claude-sonnet',
    label: 'Claude Sonnet 5.5',
    claude: 'claude-sonnet-5-5',
  },
  { value: 'cerebras-120b', label: 'Cerebras gpt-oss-120b' },
]

const claudeId = (model: AnswerModel) =>
  ANSWER_MODELS.find((m) => m.value === model)?.claude

export type AnswerConfig = {
  anthropic?: { apiKey?: string; baseUrl?: string }
  cerebras?: { apiKey?: string; baseUrl?: string }
  /** The assistant's instructions, as a live answer would get them. */
  instructions?: string
}

export type AnswerRun = {
  model: AnswerModel
  /** Time to the first word of the answer (not the model's thinking). */
  firstMs?: number
  totalMs?: number
  text: string
  error?: string
}

export type AnswerResult = { question: string; runs: AnswerRun[] }

type Chunk = {
  choices?: { delta?: { content?: string | null } }[]
}

/** Cerebras' OpenAI-style stream, as Auto sends it (same thinking level). */
async function streamCerebras(
  config: NonNullable<AnswerConfig['cerebras']>,
  messages: { role: string; content: string }[],
  signal: AbortSignal
): Promise<AsyncIterable<Chunk>> {
  const base = (config.baseUrl || 'https://api.cerebras.ai/v1').replace(
    /\/+$/,
    ''
  )
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-oss-120b',
      stream: true,
      reasoning_effort: getChatThinking(),
      messages,
    }),
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Cerebras ${res.status}: ${detail.slice(0, 200)}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  return (async function* () {
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') return
        yield JSON.parse(data) as Chunk
      }
    }
  })()
}

/** One model's answer to one question, timed from the request. */
export async function answerOnce(
  config: AnswerConfig,
  model: AnswerModel,
  question: string,
  now: () => number = () => performance.now()
): Promise<AnswerRun> {
  // The same short-code rule a live answer gets
  const system = withCodingRule(config.instructions)
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: question },
  ]
  const controller = new AbortController()
  const cut = setTimeout(() => controller.abort(), 60_000)
  const start = now()
  let firstMs: number | undefined
  let text = ''
  const claude = claudeId(model)
  try {
    const stream: AsyncIterable<Chunk> = claude
      ? await streamClaude({
          apiKey: config.anthropic?.apiKey ?? '',
          baseUrl: config.anthropic?.baseUrl,
          model: claude,
          messages,
          signal: controller.signal,
        })
      : await streamCerebras(config.cerebras ?? {}, messages, controller.signal)
    for await (const chunk of stream) {
      const piece = chunk.choices?.[0]?.delta?.content ?? ''
      if (piece && firstMs === undefined) firstMs = now() - start
      text += piece
    }
    return { model, firstMs, totalMs: now() - start, text }
  } catch (err) {
    return {
      model,
      firstMs,
      text,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(cut)
  }
}

/** The models there are keys for. */
export const availableAnswerModels = (config: AnswerConfig): AnswerModel[] =>
  ANSWER_MODELS.map((m) => m.value).filter((m) =>
    claudeId(m) ? !!config.anthropic?.apiKey : !!config.cerebras?.apiKey
  )

/**
 * Asks each question to every model at the same moment, one question after
 * another, as Auto does in a live interview.
 */
export async function compareAnswers(
  config: AnswerConfig,
  models: AnswerModel[],
  onResult: (result: AnswerResult) => void,
  questions = ANSWER_QUESTIONS
) {
  for (const question of questions) {
    const runs = await Promise.all(
      models.map((m) => answerOnce(config, m, question))
    )
    onResult({ question, runs })
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const secs = (ms?: number) =>
  ms === undefined ? '–' : `${(ms / 1000).toFixed(2)} s`

/** Each model's median time to first word and to the whole answer. */
export function answerSummary(results: AnswerResult[]) {
  return ANSWER_MODELS.map(({ value, label }) => {
    const runs = results.flatMap((r) => r.runs.filter((x) => x.model === value))
    return {
      model: value,
      label,
      count: runs.length,
      errors: runs.filter((r) => r.error).length,
      firstMs: median(
        runs.flatMap((r) => (r.firstMs === undefined ? [] : [r.firstMs]))
      ),
      totalMs: median(
        runs.flatMap((r) => (r.totalMs === undefined ? [] : [r.totalMs]))
      ),
    }
  }).filter((s) => s.count > 0)
}

/** Results as text, to paste back for a quality review. */
export function formatAnswers(results: AnswerResult[]): string {
  const label = (m: AnswerModel) =>
    ANSWER_MODELS.find((x) => x.value === m)?.label ?? m
  const summary = answerSummary(results)
    .map(
      (s) =>
        `${s.label}: first word ${secs(s.firstMs)}, whole answer ${secs(s.totalMs)} (median of ${s.count}${s.errors ? `, ${s.errors} failed` : ''})`
    )
    .join('\n')
  const body = results
    .map((r, i) =>
      [
        `## ${i + 1}. ${r.question}`,
        ...r.runs.map(
          (x) =>
            `### ${label(x.model)} (first word ${secs(x.firstMs)}, whole ${secs(x.totalMs)})\n${x.error ? `Error: ${x.error}\n` : ''}${x.text}`
        ),
      ].join('\n\n')
    )
    .join('\n\n')
  return `# Answer models\n${summary}\n\n${body}`
}
