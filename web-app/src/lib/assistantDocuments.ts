/**
 * Documents attached to an assistant. The text is pulled out in the browser
 * (nothing is uploaded) and added to the assistant's instructions on every
 * message, so it works with any text model, gpt-oss-20b included.
 */

export type AssistantDocument = { name: string; text: string }

/** Rough token count (about 4 characters per token in English). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4)

/** Above this, each message gets noticeably slower and costlier. */
export const LARGE_DOCUMENTS_TOKENS = 30_000
/** Hard cap on stored text, to stay well inside browser storage limits. */
export const MAX_DOCUMENT_CHARS = 400_000

export const ACCEPTED_DOCUMENT_TYPES =
  '.pdf,.docx,.txt,.md,.csv,.json,.yaml,.yml'

const tidy = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

async function pdfText(file: File): Promise<string> {
  // pdf.js 4 needs Promise.withResolvers (Safari 17.4+)
  const P = Promise as unknown as { withResolvers?: unknown }
  if (!P.withResolvers) {
    P.withResolvers = () => {
      let resolve: unknown, reject: unknown
      const promise = new Promise((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }
  }
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString()
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() })
    .promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent()
    pages.push(
      content.items
        .map((item) =>
          'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''
        )
        .join('')
    )
  }
  return pages.join('\n\n')
}

async function docxText(file: File): Promise<string> {
  const mammoth = await import('mammoth/mammoth.browser')
  const { value } = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  })
  return value
}

/** Pulls the text out of a PDF, Word (.docx) or plain-text file. */
export async function extractDocumentText(file: File): Promise<string> {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'pdf') return tidy(await pdfText(file))
  if (ext === 'docx') return tidy(await docxText(file))
  if (ext === 'doc') {
    throw new Error('Old .doc files are not supported; save it as .docx')
  }
  return tidy(await file.text())
}

/**
 * Documents up to this size go with every question in full. Larger ones send
 * only the passages that match the question: providers read about 20,000
 * tokens a second, so 65,000 tokens of documents held every answer back by
 * over 3 s, while this budget costs about a quarter of a second.
 */
export const DOCUMENTS_BUDGET_TOKENS = 5_000
const PASSAGE_CHARS = 1_200

const STOP_WORDS = new Set(
  'a an and are as at be but by can could did do does for from had has have how i if in into is it its me my no not of on or our so that the their them then there these they this to was we were what when where which who why will with would you your about tell explain give some any more please'.split(
    ' '
  )
)

/** Lowercase words worth matching (no stop words), with a light plural trim. */
function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) ?? [])
    .map((w) => w.replace(/[.-]+$/, ''))
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w))
}

/** Cuts a document into passages of about PASSAGE_CHARS, on line breaks. */
function passages(text: string): string[] {
  const out: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    if (current && current.length + line.length > PASSAGE_CHARS) {
      out.push(current)
      current = ''
    }
    // A very long line (a PDF page with no breaks) is cut in pieces
    for (let i = 0; i < line.length; i += PASSAGE_CHARS * 2) {
      const piece = line.slice(i, i + PASSAGE_CHARS * 2)
      if (piece.length > PASSAGE_CHARS && current) {
        out.push(current)
        current = ''
      }
      current = current ? `${current}\n${piece}` : piece
    }
    if (!line) current += '\n'
  }
  out.push(current)
  return out.map((p) => p.trim()).filter(Boolean)
}

/**
 * The parts of the documents that go with this question. Small documents go
 * whole. Larger ones are cut into passages, ranked by how well they match the
 * question (BM25, the classic search ranking, in a few milliseconds), and the
 * best are kept up to the budget, in their original order. With no match (a
 * greeting, say) none are sent.
 */
export function relevantDocuments(
  documents: AssistantDocument[] | undefined,
  question: string,
  budgetTokens = DOCUMENTS_BUDGET_TOKENS
): AssistantDocument[] | undefined {
  const docs = (documents ?? []).filter((d) => d.text.trim())
  const total = docs.reduce((sum, d) => sum + estimateTokens(d.text), 0)
  if (total <= budgetTokens) return documents
  const wanted = [...new Set(terms(question))]
  if (!wanted.length) return []
  const all = docs.flatMap((d, doc) =>
    passages(d.text).map((text, index) => ({
      doc,
      index,
      text,
      words: terms(text),
    }))
  )
  const avg = all.reduce((sum, p) => sum + p.words.length, 0) / all.length || 1
  const df = new Map<string, number>()
  for (const p of all)
    for (const w of new Set(p.words)) df.set(w, (df.get(w) ?? 0) + 1)
  const k1 = 1.2
  const b = 0.75
  const scored = all.map((p) => {
    const tf = new Map<string, number>()
    for (const w of p.words) tf.set(w, (tf.get(w) ?? 0) + 1)
    let score = 0
    for (const w of wanted) {
      const f = tf.get(w)
      if (!f) continue
      const n = df.get(w) ?? 0
      const idf = Math.log(1 + (all.length - n + 0.5) / (n + 0.5))
      score +=
        (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * p.words.length) / avg))
    }
    return { ...p, score }
  })
  const picked: typeof scored = []
  let used = 0
  for (const p of scored
    .filter((p) => p.score > 0)
    .sort((x, y) => y.score - x.score)) {
    const cost = estimateTokens(p.text)
    if (used + cost > budgetTokens) continue
    picked.push(p)
    used += cost
  }
  return docs
    .map((d, doc) => ({
      name: d.name,
      text: picked
        .filter((p) => p.doc === doc)
        .sort((x, y) => x.index - y.index)
        .map((p) => p.text)
        .join('\n\n…\n\n'),
    }))
    .filter((d) => d.text)
}

/** The assistant's instructions with its documents appended. */
export function withDocuments(
  instructions: string | undefined,
  documents: AssistantDocument[] | undefined
): string | undefined {
  const docs = (documents ?? []).filter((d) => d.text.trim())
  if (!docs.length) return instructions
  const body = docs.map((d) => `### ${d.name}\n\n${d.text}`).join('\n\n')
  return `${instructions ?? ''}\n\n## Reference documents\n\nUse these when they are relevant to the question.\n\n${body}`.trim()
}

/** The assistant without its document text, for copies kept on messages and threads. */
export function withoutDocuments<T extends { documents?: unknown }>(
  assistant: T
): T
export function withoutDocuments<T extends { documents?: unknown }>(
  assistant: T | null | undefined
): T | null | undefined
export function withoutDocuments<T extends { documents?: unknown }>(
  assistant: T | null | undefined
): T | null | undefined {
  if (!assistant || !('documents' in assistant)) return assistant
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { documents, ...rest } = assistant
  return rest as T
}
