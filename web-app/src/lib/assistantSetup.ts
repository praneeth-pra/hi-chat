import { viaGroqProxy } from '@/lib/groqProxy'
import { dictionaryTerms, extractKeyTerms } from '@/lib/keyTerms'

/**
 * Quick setup: from a resume and/or a job description (both optional, along
 * with free-text notes) build the whole interview assistant, so the user
 * only has to pick the files. A
 * gpt-oss-120b call reads who the candidate is and what the role wants;
 * the instructions themselves come from a fixed template so the rules that
 * matter (first person, never invent experience) are always there.
 */

export type CandidateProfile = {
  candidate: string
  role: string
  company: string
  /** The role in a few words, for the assistant's name. */
  title?: string
  summary: string
  focus: string[]
}

/** Enough of the resume and job description for the model to read. */
const MAX_SOURCE_CHARS = 40_000

export const PROFILE_PROMPT = `You read a candidate's resume and the job description they are interviewing for (either may be missing), plus any notes they added. Return only a JSON object with these keys:
"candidate": the candidate's full name from the resume or notes, or "" if it is not there.
"role": the job title they are interviewing for (from the job description, else the role the resume or notes target, e.g. "Data Analyst").
"company": the hiring company from the job description, or "".
"title": the role in at most 3 words, abbreviated where common, e.g. "ML Engineer" for "Senior Software Engineer, Machine Learning Infrastructure".
"summary": one short line describing the candidate for this role, e.g. "Data analyst, 4 years in SQL, Power BI and Python".
"focus": up to 8 short phrases naming what the job description stresses most (skills, tools, responsibilities); if there is no job description, the candidate's strongest areas from the resume or notes.`

type Provider = { apiKey?: string; baseUrl?: string; model: string }

/** Reads the candidate's name, target role and focus areas. */
export async function extractProfile(
  resume: string,
  jobDescription: string,
  providers: Provider[],
  fetchImpl: typeof fetch = fetch,
  notes = ''
): Promise<CandidateProfile> {
  const usable = providers.filter((p) => p.apiKey)
  if (!usable.length) throw new Error('Add a Groq or Cerebras API key first')
  const content =
    (resume.trim()
      ? `Resume:\n${resume.slice(0, MAX_SOURCE_CHARS)}`
      : 'No resume was given.') +
    (jobDescription.trim()
      ? `\n\nJob description:\n${jobDescription.slice(0, MAX_SOURCE_CHARS)}`
      : '\n\nNo job description was given.') +
    (notes.trim()
      ? `\n\nNotes from the candidate:\n${notes.slice(0, MAX_SOURCE_CHARS)}`
      : '')
  let lastError: unknown
  for (const p of usable) {
    try {
      const res = await fetchImpl(
        `${viaGroqProxy(p.baseUrl!)}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${p.apiKey}`,
          },
          body: JSON.stringify({
            model: p.model,
            temperature: 0,
            max_tokens: 2000,
            reasoning_effort: 'low',
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: PROFILE_PROMPT },
              { role: 'user', content },
            ],
          }),
        }
      )
      if (!res.ok) throw new Error(`${p.model} failed (${res.status})`)
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[]
      }
      return parseProfile(data.choices?.[0]?.message?.content ?? '')
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

const text = (value: unknown, max = 120) =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : ''

export function parseProfile(raw: string): CandidateProfile {
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  const data = JSON.parse(json) as Record<string, unknown>
  return {
    candidate: text(data.candidate, 60),
    role: text(data.role, 80),
    company: text(data.company, 80),
    title: text(data.title, 40),
    summary: text(data.summary, 200),
    focus: Array.isArray(data.focus)
      ? data.focus
          .map((f) => text(f, 80))
          .filter(Boolean)
          .slice(0, 8)
      : [],
  }
}

/** Longest name shown, so it fits the assistant picker. */
const MAX_NAME_CHARS = 28

/** Cuts at a word boundary and drops a trailing separator. */
function clip(value: string, max: number) {
  if (value.length <= max) return value
  const space = value.lastIndexOf(' ', max)
  return (space > 0 ? value.slice(0, space) : value.slice(0, max)).replace(
    /[\s,·:\-–—&]+$/,
    ''
  )
}

/** "Acme · Data Analyst", or just the short role when the company is unknown. */
export function assistantName(profile: CandidateProfile): string {
  const role = clip(
    profile.title || profile.role || 'Interview',
    MAX_NAME_CHARS
  )
  const company = profile.company.split(/[,(]/)[0].trim()
  const name = company ? `${company} · ${role}` : role
  return name.length <= MAX_NAME_CHARS ? name : role
}

/** The free-text notes saved next to the resume and job description. */
export const OTHER_CONTEXT_NAME = 'Other context'

export function buildInstructions(
  profile: CandidateProfile,
  hasJobDescription: boolean,
  hasOtherContext = false,
  hasResume = true
): string {
  const who =
    profile.candidate ||
    (hasResume ? 'the candidate in the resume' : 'the candidate')
  const role = profile.role ? `the ${profile.role} role` : 'this role'
  const at = profile.company ? ` at ${profile.company}` : ''
  const lines = [
    `You are ${who}, interviewing for ${role}${at}. Answer every question the way ${who} would say it in the interview: first person, natural and confident.`,
    '',
    ...(hasResume
      ? [
          '- Your background is the resume in your documents. Use its real employers, projects, tools, numbers and dates.',
          '- Never invent experience, projects, results, skills or numbers (metrics, timings, percentages) that are not in the resume. When a question goes beyond it, answer from the closest related experience or explain how you would approach it, without claiming you have done it.',
          '- For technical questions, explain the concept clearly. When the resume shows you used it, end with one short line on how you used it there; when it does not, leave that line out.',
          '- For behavioural questions, use a real situation from the resume: the situation, what you did, and the result.',
        ]
      : [
          `- There is no resume, so you only know your background from ${hasOtherContext ? `"${OTHER_CONTEXT_NAME}" in your documents and ` : ''}what the user says in the conversation.`,
          '- Never invent experience, employers, projects, results, skills or numbers (metrics, timings, percentages). When a question asks about your past work and nothing above covers it, explain how you would approach it, without claiming you have done it.',
          '- For technical questions, explain the concept clearly.',
          '- For behavioural questions, give the structure of a strong answer (the situation, what you did, and the result) using only real details you have, and keep the rest general.',
        ]),
  ]
  if (hasJobDescription)
    lines.push(
      `- The job description is also in your documents. Where it fits naturally, connect your answers to what this role needs${profile.focus.length ? `: ${profile.focus.join(', ')}` : ''}.`
    )
  else if (profile.focus.length)
    lines.push(`- Your strongest areas: ${profile.focus.join(', ')}.`)
  if (hasOtherContext)
    lines.push(
      `- "${OTHER_CONTEXT_NAME}" in your documents is what you added${hasResume ? ' beyond the resume' : ' about yourself'}, such as why you are moving on, notice period, salary expectations or location. Treat it as true about you and use it when a question touches it.`
    )
  return lines.join('\n')
}

export type SetupFile = { name: string; text: string }

/**
 * Splits a saved assistant's documents back into resume, job description and
 * notes. Older assistants have no kind: the first document is the resume.
 */
export function savedSetupFiles(documents: Assistant['documents'] = []): {
  resume?: SetupFile
  jd?: SetupFile
  notes: string
} {
  const strip = (d?: { name: string; text: string }) =>
    d ? { name: d.name, text: d.text } : undefined
  const notes = documents.find((d) => d.name === OTHER_CONTEXT_NAME)?.text ?? ''
  if (documents.some((d) => d.kind))
    return {
      resume: strip(documents.find((d) => d.kind === 'resume')),
      jd: strip(documents.find((d) => d.kind === 'job')),
      notes,
    }
  return {
    resume: strip(documents[0]),
    jd: strip(documents.slice(1).find((d) => d.name !== OTHER_CONTEXT_NAME)),
    notes,
  }
}

export type SetupKeys = {
  groq?: { apiKey?: string; baseUrl?: string }
  cerebras?: { apiKey?: string; baseUrl?: string }
}

/**
 * Builds the whole assistant from the resume, job description and notes the
 * resume doesn't cover. Each is optional, but at least one is needed. Editing
 * keeps the assistant's id, emoji, creation time and settings.
 */
export async function setupAssistant(
  resume: SetupFile | undefined,
  jobDescription: SetupFile | undefined,
  keys: SetupKeys,
  base?: Assistant,
  fetchImpl: typeof fetch = fetch,
  otherContext = ''
): Promise<Assistant> {
  const cv = resume?.text.trim() ? resume : undefined
  const jd = jobDescription?.text.trim() ? jobDescription : undefined
  const notes = otherContext.trim()
    ? { name: OTHER_CONTEXT_NAME, text: otherContext.trim() }
    : undefined
  if (!cv && !jd && !notes)
    throw new Error('Add a resume, a job description or some context first')
  const documents = [
    ...(cv ? [{ ...cv, kind: 'resume' as const }] : []),
    ...(jd ? [{ ...jd, kind: 'job' as const }] : []),
    ...(notes ? [notes] : []),
  ]
  const [profile, terms] = await Promise.all([
    extractProfile(
      cv?.text ?? '',
      jd?.text ?? '',
      [
        {
          apiKey: keys.groq?.apiKey,
          baseUrl: keys.groq?.baseUrl || 'https://api.groq.com/openai/v1',
          model: 'openai/gpt-oss-120b',
        },
        {
          apiKey: keys.cerebras?.apiKey,
          baseUrl: keys.cerebras?.baseUrl || 'https://api.cerebras.ai/v1',
          model: 'gpt-oss-120b',
        },
      ],
      fetchImpl,
      notes?.text
    ),
    // Key terms come from both files (resume capped so the JD always fits).
    // They only help dictation, so a failure doesn't stop setup
    extractKeyTerms(
      [
        cv && `Resume:\n${cv.text.slice(0, MAX_SOURCE_CHARS)}`,
        jd && `Job description:\n${jd.text}`,
        notes && `${OTHER_CONTEXT_NAME}:\n${notes.text}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      keys.groq ?? {},
      dictionaryTerms(),
      fetchImpl
    ).catch(() => [] as string[]),
  ])
  return {
    avatar: base?.avatar ?? '',
    id: base?.id ?? Math.random().toString(36).substring(7),
    created_at: base?.created_at ?? Date.now(),
    name: assistantName(profile),
    description: profile.summary,
    instructions: buildInstructions(profile, !!jd, !!notes, !!cv),
    documents,
    ...(terms.length ? { keyterms: terms } : {}),
    parameters: base?.parameters ?? {},
  }
}
