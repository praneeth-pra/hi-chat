import { viaGroqProxy } from '@/lib/groqProxy'

/**
 * Key terms: technical words the speaker is likely to say (VPC, NAT gateway,
 * Direct Connect). They are kept on the assistant, sent to Grok live to bias
 * its transcription, and given to the judge so it can fix a misheard term.
 */

/** xAI's limits: 100 terms of up to 50 characters each. */
export const MAX_KEY_TERMS = 100
export const MAX_KEY_TERM_CHARS = 50

/** Cleans a list: trimmed, no duplicates (any case), within xAI's limits. */
export function cleanKeyTerms(terms: string[], max = MAX_KEY_TERMS): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of terms) {
    const term = raw
      .replace(/^[\s\-*•\d.)]+/, '')
      .replace(/\s+/g, ' ')
      .trim()
    const key = term.toLowerCase()
    if (!term || term.length > MAX_KEY_TERM_CHARS || seen.has(key)) continue
    seen.add(key)
    out.push(term)
    if (out.length === max) break
  }
  return out
}

/** Terms typed one per line or separated by commas. */
export const parseKeyTerms = (text: string, max = MAX_KEY_TERMS) =>
  cleanKeyTerms(text.split(/[\n,;]+/), max)

/**
 * Coding-round words speech engines often mishear (09 Oct: "bubble shot",
 * "shorting", "intending to put oil" for insertion sort). Only the judge gets
 * them, after the assistant's own terms, so they don't use up Grok's 100.
 */
export const CODING_KEY_TERMS = [
  'sorting',
  'bubble sort',
  'insertion sort',
  'selection sort',
  'merge sort',
  'quick sort',
  'heap sort',
  'swap',
  'XOR',
  'in-built methods',
  'time complexity',
  'space complexity',
  'recursion',
  'linked list',
  'binary search',
  'hash map',
]

/** The assistant's terms, then the coding terms it doesn't already have. */
export const withCodingTerms = (terms: string[]) =>
  cleanKeyTerms([...terms, ...CODING_KEY_TERMS], Infinity)

/**
 * Your own dictionary (for example Wispr Flow's), kept in this browser. It
 * can be far longer than the 100 terms Grok takes; "Suggest" on an assistant
 * picks the ones that fit it.
 */
export const DICTIONARY_STORAGE_KEY = 'speaker-dictionary'
export const MAX_DICTIONARY_TERMS = 2000

export function getDictionary(): string {
  try {
    return localStorage.getItem(DICTIONARY_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setDictionary(text: string) {
  try {
    localStorage.setItem(DICTIONARY_STORAGE_KEY, text)
  } catch {
    // Storage blocked: the dictionary isn't kept
  }
}

export const dictionaryTerms = () =>
  parseKeyTerms(getDictionary(), MAX_DICTIONARY_TERMS)

/**
 * The terms in use for dictation: the assistant's own, or else the start
 * of the dictionary.
 */
export function activeKeyTerms(assistantTerms?: string[]): string[] {
  return assistantTerms?.length
    ? cleanKeyTerms(assistantTerms)
    : dictionaryTerms().slice(0, MAX_KEY_TERMS)
}

/** Enough of the documents for the model to find the terms. */
const MAX_SOURCE_CHARS = 60_000

export const KEY_TERMS_PROMPT = `List the technical terms someone is likely to say out loud in a conversation about the text below: product and service names, acronyms, tools, protocols and jargon (for example "VPC", "NAT gateway", "Kubernetes", "Terraform"). Speech recognition will be biased toward these words, so each term must be one to three words, as people say it ("Application Gateway", not "Azure DevOps Test Runs"); leave out ordinary English words, long phrases and vendor prefixes that are not spoken. If a dictionary of the user's own words is given, include every dictionary term that appears in or clearly relates to the text, spelled as in the dictionary, then add other terms from the text. Give up to ${MAX_KEY_TERMS} terms, most important first, one per line, with nothing else.`

/**
 * Asks Groq gpt-oss-20b for the key terms in an assistant's instructions and
 * documents. Throws if Groq fails.
 */
export async function extractKeyTerms(
  text: string,
  groq: { apiKey?: string; baseUrl?: string },
  dictionary: string[] = [],
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  if (!groq.apiKey) throw new Error('Add a Groq API key first')
  const base = viaGroqProxy(groq.baseUrl || 'https://api.groq.com/openai/v1')
  const res = await fetchImpl(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groq.apiKey}`,
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      temperature: 0,
      max_tokens: 2000,
      reasoning_effort: 'low',
      include_reasoning: false,
      messages: [
        { role: 'system', content: KEY_TERMS_PROMPT },
        {
          role: 'user',
          content:
            (dictionary.length
              ? `Dictionary:\n${dictionary.join('\n')}\n\nText:\n`
              : '') + text.slice(0, MAX_SOURCE_CHARS),
        },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Groq failed (${res.status})`)
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  return cleanKeyTerms((data.choices?.[0]?.message?.content ?? '').split('\n'))
}
