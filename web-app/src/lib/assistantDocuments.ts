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
