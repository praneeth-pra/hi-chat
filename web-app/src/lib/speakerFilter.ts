import { groqFetch, viaGroqProxy } from '@/lib/groqProxy'
import { chatterReason } from '@/lib/speakerChatter'
import { withCodingTerms } from '@/lib/keyTerms'
import {
  SMART_TURN_HOLD_BELOW,
  SMART_TURN_HOLD_MS,
  type TurnCheck,
} from '@/lib/smartTurn'

/**
 * Decides whether a transcribed speaker clip is sent to the chat. Accepted
 * text is sent automatically, so the filter errs on the side of dropping.
 */

const ASK_START =
  /^(what|why|how|when|where|who|whom|whose|which|can|could|would|should|shall|will|is|are|am|was|were|do|does|did|tell me|explain|describe|walk me through|give me|show me|compare|define)\b/i

/** Local check: a sentence ending in "?" or opening like a question or request. */
export function looksLikeQuestion(text: string): boolean {
  const sentences = text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return sentences.some((s) => s.endsWith('?') || ASK_START.test(s))
}

export type GroqConfig = {
  apiKey?: string
  baseUrl?: string
  /** With a key, the check runs on Cerebras first and Groq is the fallback. */
  cerebras?: { apiKey?: string; baseUrl?: string }
  /** For the Claude judges; Settings > Model Providers > Anthropic. */
  anthropic?: { apiKey?: string; baseUrl?: string }
  /** Defaults to Cerebras gpt-oss-120b. */
  judge?: JudgeModel
  /** Technical words the speaker is likely to say; used to fix mishearings. */
  keyterms?: string[]
  /** Coding mode: the candidate is coding on a shared screen. */
  coding?: boolean
  /** Whether the judge names clip types; defaults to the Settings switch. */
  clipTypes?: boolean
  /**
   * A second judge asked at the same time. When the two disagree on sending a
   * clip, it is offered as a one-tap suggestion instead (see Unsure).
   */
  secondJudge?: JudgeModel
}

/** Cerebras serves gpt-oss-120b fast enough to use the stronger model. */
export const CEREBRAS_CLASSIFIER_MODEL = 'gpt-oss-120b'
const CEREBRAS_TIMEOUT_MS = 2000
/** After this long without a Cerebras answer, Groq is asked as well. */
const CEREBRAS_HEDGE_MS = 1000

/** The model that judges speaker clips, picked in Settings > General. */
export type JudgeModel =
  | 'cerebras-120b'
  | 'cerebras-120b-think'
  | 'claude-haiku'
  | 'claude-sonnet'
  | 'groq-120b'
  | 'groq-20b'
export const JUDGE_MODELS: { value: JudgeModel; label: string }[] = [
  { value: 'cerebras-120b', label: 'Cerebras gpt-oss-120b' },
  { value: 'cerebras-120b-think', label: 'Cerebras gpt-oss-120b, thinks more' },
  { value: 'claude-haiku', label: 'Claude Haiku 4.5' },
  { value: 'claude-sonnet', label: 'Claude Sonnet 5.5' },
  { value: 'groq-120b', label: 'Groq gpt-oss-120b' },
  { value: 'groq-20b', label: 'Groq gpt-oss-20b' },
]

/** Claude judges; the Anthropic key comes from the Anthropic provider. */
const CLAUDE_JUDGES: Partial<Record<JudgeModel, string>> = {
  'claude-haiku': 'claude-haiku-4-5',
  'claude-sonnet': 'claude-sonnet-5-5',
}
const CLAUDE_TIMEOUT_MS = 4000
/**
 * After this long without a Claude answer, Cerebras is asked as well and the
 * first answer wins, so a slow Claude reply never holds a question for long.
 */
const CLAUDE_HEDGE_MS = 1500
/** Cerebras with medium reasoning thinks longer, so it gets more time. */
const THINK_HEDGE_MS = 1500
const THINK_TIMEOUT_MS = 3000
export const JUDGE_MODEL_STORAGE_KEY = 'speaker-judge-model'

export function getJudgeModel(): JudgeModel {
  try {
    const saved = localStorage.getItem(JUDGE_MODEL_STORAGE_KEY)
    return JUDGE_MODELS.some((m) => m.value === saved)
      ? (saved as JudgeModel)
      : 'cerebras-120b'
  } catch {
    return 'cerebras-120b'
  }
}

export function setJudgeModel(model: JudgeModel) {
  try {
    localStorage.setItem(JUDGE_MODEL_STORAGE_KEY, model)
  } catch {
    // Storage blocked: the default stays in effect
  }
}

/**
 * Fastest good model first: every YES is sent to the chat, and the check adds
 * to the wait for each clip (gpt-oss-20b takes about 0.4 s, 120b about 1 s).
 * Groq answers 404 for a model it no longer serves, so the next one is tried
 * and the one that works is kept.
 */
export const CLASSIFIER_MODELS = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'llama-3.1-8b-instant',
]
let workingModel = 0

/** For tests: start again from the first model. */
export function resetClassifierModel() {
  workingModel = 0
}

/** gpt-oss thinks before answering; keep that short and out of the reply. */
const isReasoningModel = (model: string) => model.includes('gpt-oss')

export const CLASSIFIER_PROMPT = `You filter speech transcribed from a computer's speaker (for example an interviewer or colleague on a call). Every clip you accept is sent straight to a chat assistant as a question, so be strict.

Reply YES only if the clip is a complete, meaningful question or request that someone would want answered, either on its own or as a clear follow-up to the recent clips.
An interviewer's task or exercise counts as a request even when it is not phrased as a question: write or fix code, work out an output, solve a problem, or do it another way. So do its constraints and changes said as statements: "I want you to...", "Don't use...", "Only thing is...", "Forget about the code, explain the logic."
A misheard word does not make a clip garbled ("shorting" for "sorting", "bubble shot" for "bubble sort"): judge what the speaker meant.
Reply NO for anything else: incomplete or garbled fragments, filler, small talk, greetings, thanks, checks like "can you hear me?", call logistics (sharing a screen, opening the chat, unmuting, opening a compiler, editor or website, scrolling, reading out what is on screen), tag or rhetorical questions, statements that ask for nothing, music, ads, narration.

Examples:
"What is a Kubernetes pod?" -> YES
"Can you walk me through how you handled the outage?" -> YES
"Tell me about your last project." -> YES
"And how would that work with Postgres?" (after a clip about database migrations) -> YES
"Why?" (right after a clip explaining a design choice) -> YES
"I want you to find the sum of the numbers in this string. The output should be 100." -> YES
"Let's do it without regular expressions, in pure Python." (after a coding task) -> YES
"I want you to do-perform a shorting over that." (after "I've shared a list in the chat.") -> YES
"Forget about programming, bring the logic." (after a coding task) -> YES
"Can you please share your screen now?" -> NO
"Can you please go to the chat?" -> NO
"Can you share the screen, open an online compiler?" -> NO
"Can you read the first line?" -> NO
"Can you ping that query in the chat?" -> NO
"Share me that query." -> NO
"Can you help?" -> NO
"So you can tell any?" -> NO
"You know what I mean?" -> NO
"Right, okay, so let's see." -> NO
"Can you hear me now?" -> NO
"Is that clear?" -> NO
"How are you doing today?" -> NO
"Thanks, that was great." -> NO

Recent clips marked [sent] already went to the assistant. Reply NO if the clip only repeats or restates one of those questions, even in other words, or shortens it ("How to write SQL queries?" right after "Do you know how to write SQL queries?"; "Write that command." right after "Can you run that command?").
Also reply NO to bare confirmation checks, which only ask the candidate to confirm or stand by something already asked or said, or a personal detail, and add nothing new: "Are you sure about that?", "Is that right?", "You said it is available, is that right?", "So you're not working right now?", "You're available immediately, right?". The assistant has already answered the question they confirm. A request for more of something named is not a confirmation check: "Any other networking options you can think of apart from these?" or "What other tools have you used?" -> YES.
A follow-up that adds something is a genuine question, so reply YES: a new case or condition, a counter-claim, or asking why or how ("Are you sure? I thought it is attached to the subnet.", "Is that right even for a private subnet?", "Why is that?").

Start your reply with one word: YES or NO.`

/** The judge sees this many recent clips in detail. */
export const RECENT_CLIPS = 6
/**
 * The judge also sees the interview before them, up to this many clips (about
 * 4,000 tokens for a 30-minute interview).
 */
export const HISTORY_CLIPS = 200
/**
 * Of that history, the judge only sees clips heard in the last 5 minutes, so
 * its prompt stays short and it answers sooner late in a long interview.
 */
export const HISTORY_SECONDS = 5 * 60

/** Added when the judge sees earlier parts of the interview. */
export const INTERVIEW_PROMPT = `You also see the last few minutes of the interview, so make a considered decision with all of it in mind, not just the last few clips. Only the interviewer's side is transcribed; the candidate's answers are not. Use the history to:
- know which stage the interview is in (introductions, experience and theory questions, a hands-on stretch where the candidate shares their screen and writes code or queries, wrap-up). In a hands-on stretch, instructions and commentary about the screen ("Where is the SRC?", "Use all these sections and show me.", "Can you do that now?") are NO even when coding mode is off, while a new task, a correction to it, or a concept question is YES.
- skip a question that was already sent earlier in the interview, unless it now asks something new;
- understand short follow-ups ("How?", "Why?", "And the second one?") from what was asked before.`

/**
 * The judge names what kind of clip it heard, so a wrong send can be traced
 * to the type that let it through. A skip type vetoes a YES; a send type
 * never overrides a NO (on 09 Oct that sent "Can you write that?" and other
 * screen requests the judge had rightly said NO to).
 */
export const CLIP_TYPES = [
  {
    type: 'question',
    send: true,
    hint: 'a new question or request, including a challenge or counter-claim to what was said',
  },
  {
    type: 'task',
    send: true,
    hint: 'a coding task or exercise, or a change, constraint or correction to it, even said as a statement',
  },
  {
    type: 'follow-up',
    send: true,
    hint: 'a short follow-up that asks something new about what came before ("Why?", "How?", "What other tools?")',
  },
  {
    type: 'repeat',
    send: false,
    hint: 'restates or shortens a question already [sent]',
  },
  {
    type: 'confirmation',
    send: false,
    hint: 'a bare check that the candidate stands by something already said ("Are you sure?", "Is that right?")',
  },
  {
    type: 'logistics',
    send: false,
    hint: 'call or screen logistics: share, open, scroll, read out, copy, run, write in the chat or notepad',
  },
  {
    type: 'commentary',
    send: false,
    hint: 'running commentary on a shared screen: progress checks, "what are you doing?", hints, encouragement',
  },
  {
    type: 'statement',
    send: false,
    hint: "a statement that asks for nothing, including the interviewer repeating the candidate's answer back",
  },
  {
    type: 'chatter',
    send: false,
    hint: 'filler, small talk, greetings, thanks, "can you hear me?"',
  },
  { type: 'fragment', send: false, hint: 'incomplete or garbled words' },
  {
    type: 'other',
    send: false,
    hint: 'not part of the interview: another conversation or language, music, ads, narration',
  },
] as const

export type ClipType = (typeof CLIP_TYPES)[number]['type']

/** True when a clip of this type is sent; undefined for an unknown type. */
export function sendsType(type: string): boolean | undefined {
  return CLIP_TYPES.find((t) => t.type === type)?.send
}

/** Asks the judge for its reason only (clip types off). */
export const REASON_PROMPT = `After your answer, add a new line starting with "Why:" and a few words on your reason. Nothing else.`

/** Settings > General: whether the judge names clip types (on by default). */
export const CLIP_TYPES_STORAGE_KEY = 'speaker-clip-types'

export function getClipTypes(): boolean {
  try {
    return localStorage.getItem(CLIP_TYPES_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setClipTypes(on: boolean) {
  try {
    localStorage.setItem(CLIP_TYPES_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Storage blocked: the default stays in effect
  }
}

/** Asks the judge for the clip's type and its reason, each on its own line. */
export const WHY_PROMPT = `After your answer, add a new line "Type: " followed by exactly one of these labels for the clip:
${CLIP_TYPES.map((t) => `- ${t.type}: ${t.hint}`).join('\n')}
YES and MORE go with question, task or follow-up; NO goes with the others. Then add a new line starting with "Why:" and a few words on your reason. Nothing else.`

/**
 * Takes the "Type:" line out of the judge's answer: [answer, type]. The type
 * is lower-cased, and '' when missing.
 */
export function splitType(verdict: string): [string, string] {
  // Only a known label counts, so a clip that says "type:" is left alone;
  // the line may also follow the answer on the same line ("YES Type: task")
  const labels = CLIP_TYPES.map((t) => t.type).join('|')
  const match = new RegExp(`\\btype\\s*:\\s*(${labels})\\b[^\\n]*`, 'i').exec(
    verdict
  )
  if (!match) return [verdict, '']
  return [
    (
      verdict.slice(0, match.index) +
      verdict.slice(match.index + match[0].length)
    ).trim(),
    match[1].toLowerCase(),
  ]
}

/** Splits the judge's reply into its answer and the reason after "Why:". */
export function splitWhy(reply: string): [string, string] {
  const at = reply.search(/\bwhy\s*:/i)
  if (at < 0) return [reply, '']
  return [
    reply.slice(0, at).trim(),
    reply
      .slice(at)
      .replace(/^\s*why\s*:\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160),
  ]
}

/** "14:05" for a time in ms, in this browser's time zone. */
function clockTime(ms: number) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Added when "wait for the rest" is on: a question cut off by a pause, or an
 * interviewer's lead-in, is held and joined to the next clip.
 */
export const WAIT_PROMPT = `There is a third answer, WAIT. Reply WAIT instead of NO when the clip is the start of a question the speaker has not finished: it breaks off mid-sentence, it is a lead-in an interviewer says right before asking, or it sets up a scenario, example or piece of code the next question will be about. The next clip will be joined to it and judged again, so the question keeps its setup.

Examples:
"Can you explain how you would" -> WAIT
"So when you designed the payment" -> WAIT
"I see you led the migration to microservices." -> WAIT
"Okay, let's move on to system design." -> WAIT
"Let's say I have name equals Nagarjuna, and then I update name to Rajat." -> WAIT
"Now you see there are numbers and letters in this string, right?" -> WAIT`

/** A clip this soon after a sent question may be joined to it. */
export const JOIN_WINDOW_S = 30

/**
 * Added while coding mode is on: the candidate is coding on a shared screen.
 * Real questions still go through; the commentary around the screen does not.
 */
export const CODING_PROMPT = `Right now the candidate is sharing their screen and writing code, and the interviewer is watching. Real questions still count, and the interviewer often asks them in short pieces. Reply YES for:
- the coding task, and any change or correction to it: expected output, input, constraints, a different approach, or saying the output is wrong ("It is repeated two times, but you're showing one time.", "Not T-H-I-S, I-S.")
- technical follow-ups about the code or a concept: why a choice was made, complexity, edge cases, what a function or keyword does
- questions about the candidate's experience, how they rate themselves, or a challenge to what they said or showed ("Have you used it much, or only once?", "How do you rate yourself on Python out of five?", "This is TestNG, not Selenium.")
Reply NO to the running commentary around the screen: progress and status checks, asking what the candidate is doing or what happened, telling them to scroll, read out, open, copy, run or show something, "you understood?", hints and encouragement.

A correction is often spread over several clips. If this clip only makes sense together with recent clips that were not sent, reply "YES: " followed by those clips and this one joined in the speaker's own words (leave out the commentary, do not answer or rephrase). Otherwise reply just YES or NO.

Examples:
"Can you build a word count out of this sentence?" -> YES
"I want you to show two times." (after "So here, is appears two times." and "Not T-H-I-S, I-S.", not sent) -> YES: So here, is appears two times. Not T-H-I-S, I-S. I want you to show two times.
"Why did you use a set here instead of a list?" -> YES
"What is the time complexity of this?" -> YES
"What happened?" -> NO
"What are you doing? Can you explain?" -> NO
"What is the first line?" -> NO
"Tell me if it is there." -> NO
"Scroll up." -> NO
"You can copy the string I sent in the chat." -> NO`

/**
 * A question asked in pieces, with long pauses, keeps its setup and late
 * additions (07 Oct: "Using JMeter." after "Are you doing some A/B testing?"
 * and "It could be a bearer token." were skipped). Also used in coding mode:
 * on 07 Oct "The failed test. Automatically." after "Then how do you debug"
 * was skipped while coding mode was on.
 */
export const JOIN_PROMPT = `Interviewers often ask in pieces, with long pauses between them. Two cases need the earlier pieces:
- The clip continues the question marked [sent] less than ${JOIN_WINDOW_S} s ago: it adds a detail (a tool, scope, part, constraint or clarification), asks the same question again in other words ("Or maybe why...", "I mean..."), or narrows it, and no other question came in between. Reply "MORE: " followed by that question and this clip joined, so the assistant answers the whole question; its answer to the earlier wording is replaced. A different question on the same topic is a new question: reply YES.
- The clip is a question whose setup came in recent clips that were not sent: a scenario, an example, "let's say...". Reply "YES: " followed by those setup clips and this clip joined.
Use the speaker's own words, leave out the candidate's replies and small talk, and do not answer or rephrase. In every other case reply just YES or NO.

Examples:
"Using JMeter." (after "[sent 5 s ago] Are you doing some A/B testing?") -> MORE: Are you doing some A/B testing? Using JMeter.
"Main components." (after "[sent 3 s ago] Explain me JMeter.") -> MORE: Explain me JMeter. Main components.
"It could be a bearer token." (after "[sent 20 s ago] How will you extract the token?") -> MORE: How will you extract the token? It could be a bearer token.
"Only thing is, like, don't use a third variable." (after "[sent 2 s ago] Swap the values in line 12.") -> MORE: Swap the values in line 12. Only thing is, like, don't use a third variable.
"Or maybe why is Transit Gateway required at all, when we have VPC peering?" (after "[sent 9 s ago] Why do you require a Transit Gateway, and what problem does it solve?") -> MORE: Why do you require a Transit Gateway, and what problem does it solve? Or maybe why is Transit Gateway required at all, when we have VPC peering?
"And is the internet gateway attached to a subnet or the VPC?" (after "[sent 8 s ago] How would you make a subnet public?") -> YES
"How will you extract the token?" (after "So let's say this is a token response. Keep an eye on the chat.", not sent) -> YES: So let's say this is a token response. Keep an eye on the chat. How will you extract the token?
"Yeah." (after any question) -> NO`

/**
 * A merged wording shorter than this share of the shortest transcript has
 * lost more than filler (at 21:20 the judge sent only the last of five
 * sentences), so the first transcript is sent instead.
 */
export const MIN_MERGED_SHARE = 0.5

/** Added when two engines transcribed the clip and their wording differs. */
export const MERGE_PROMPT = `The clip was transcribed by two or three speech engines (A, B, C), which differ slightly. Decide YES or NO as above. If YES, reply "YES: " followed by the single most accurate wording of the clip: where they differ, use the wording two engines agree on (unless it makes no sense in context); otherwise pick the words that make sense in context ("A is 5, B is 6", not "A is 5, B is C"). Do not answer, shorten, or rephrase it. If NO (or WAIT), reply just that word.

The clip may also catch the other person on the call (the candidate) replying, for example "Yes.", "Mm-hmm.", "It is attached to a VPC." or a longer answer. Leave out only those replies. Keep every sentence the speaker said that leads up to the question, such as setup or context ("Suppose I have a private subnet that needs internet access, right?", "And where are the rules?"), because the assistant needs it to answer. Never cut the question down to its last sentence.

If key terms are listed and an engine's words sound like one of them ("navigate where" for "NAT gateway"), use the key term.`

/** Added when the wait for the rest of a question ran out. */
export const FINAL_PROMPT = `The speaker has stopped and nothing more is coming. Reply YES if the clip is still a question or request worth answering on its own, otherwise NO.`

/** The transcript naming the most key terms; the first one on a tie. */
export function withMostKeyTerms(texts: string[], keyterms: string[]): string {
  const terms = keyterms.map(normalize).filter(Boolean)
  const hits = (text: string) => {
    const t = ` ${normalize(text)} `
    return terms.filter((k) => t.includes(` ${k} `)).length
  }
  let best = texts[0]
  let most = hits(best)
  for (const text of texts.slice(1)) {
    const n = hits(text)
    if (n > most) {
      best = text
      most = n
    }
  }
  return best
}

/** True when most of `clip`'s words appear in `text` (a join kept the clip). */
export function keepsWords(text: string, clip: string): boolean {
  const have = new Set(normalize(text).split(' '))
  const words = normalize(clip).split(' ').filter(Boolean)
  return (
    words.length > 0 &&
    words.filter((w) => have.has(w)).length >= words.length * 0.8
  )
}

/** Lowercase words only, so punctuation or casing differences count as agreement. */
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')

/** Drops transcripts that say the same thing as an earlier one (ElevenLabs first). */
export function distinctTranscripts(texts: string[]): string[] {
  const seen = new Set<string>()
  return texts.filter((t) => {
    const key = normalize(t)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The judge thinks the speaker hasn't finished the question yet. */
export type Wait = { wait: string }
/** The question just sent, joined with this clip that continues it. */
export type More = { more: string }
/**
 * Text to send, a clip to hold for the rest of the question, the question
 * just sent joined with this clip, or null to drop.
 */
/** The two judges disagreed: offer the clip to send with one tap. */
export type Unsure = { unsure: string }

export type Verdict = string | Wait | More | Unsure | null

export const isWait = (v: Verdict): v is Wait =>
  typeof v === 'object' && v !== null && 'wait' in v
export const isUnsure = (v: Verdict): v is Unsure =>
  typeof v === 'object' && v !== null && 'unsure' in v

export const isMore = (v: Verdict): v is More =>
  typeof v === 'object' && v !== null && 'more' in v

/** Which model judged a clip, how long the check took, and why it was skipped. */
export type CheckInfo = {
  model: string
  ms: number
  note?: string
  /** The clip type the judge named (see CLIP_TYPES). */
  type?: string
}

/** Adds a note to a check, keeping any note it already has. */
const withNote = (info: CheckInfo, note: string): CheckInfo => ({
  ...info,
  note: info.note ? `${note}; ${info.note}` : note,
})

/** Adds a note to a judged reply, keeping any note it already has. */
const withJudgedNote = <T extends { note?: string }>(
  j: T,
  note: string
): T => ({
  ...j,
  note: j.note ? `${note}; ${j.note}` : note,
})

/** Thrown when the Groq check can't run; the clip is not sent. */
export class RelevanceCheckError extends Error {}

/**
 * 'wait' lets the judge hold an unfinished question; 'final' re-judges a held
 * one after nothing followed it.
 */
export type JudgeMode = 'plain' | 'wait' | 'final'

/** Returns the text to send, a clip to hold, or null to drop it. Throws if Groq fails. */
async function classifyWithGroq(
  texts: string[],
  recent: RecentClip[],
  groq: GroqConfig,
  onCheck?: (info: CheckInfo) => void,
  mode: JudgeMode = 'plain'
): Promise<Verdict> {
  const allowWait = mode === 'wait'
  const clipTypes = groq.clipTypes ?? getClipTypes()
  const started = Date.now()
  const merge = texts.length > 1
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  // The last few clips with how long ago each was heard; before them, the
  // rest of the last few minutes with clock times.
  const last = recent.slice(-RECENT_CLIPS)
  const earlier = recent
    .slice(0, -RECENT_CLIPS)
    .filter((r) => r.ago === undefined || r.ago <= HISTORY_SECONDS)
  const context = last.length
    ? `Recent clips, oldest first:\n${last.map((r) => `- ${r.sent ? `[sent${r.ago !== undefined ? ` ${r.ago} s ago` : ''}] ` : ''}${r.text}`).join('\n')}\n\n`
    : ''
  const earlierLines = earlier.map(
    (r) =>
      `- [${r.at !== undefined ? clockTime(r.at) : 'earlier'}${r.sent ? ', sent' : ''}] ${r.text}\n`
  )
  const earlierHeader = earlier.length
    ? 'Earlier in this interview, oldest first (clock times):\n'
    : ''
  const judgeTerms = withCodingTerms(groq.keyterms ?? [])
  const terms = merge
    ? `Key terms the speaker may use: ${judgeTerms.join(', ')}\n\n`
    : ''
  const clip = merge
    ? `Clip to judge:\n${texts
        .slice(0, 3)
        .map((t, i) => `${'ABC'[i]}: "${t}"`)
        .join('\n')}`
    : `Clip to judge: "${texts[0]}"`
  const system = [
    CLASSIFIER_PROMPT,
    earlier.length > 0 && INTERVIEW_PROMPT,
    clipTypes ? WHY_PROMPT : REASON_PROMPT,
    JOIN_PROMPT,
    groq.coding && CODING_PROMPT,
    allowWait && WAIT_PROMPT,
    merge && MERGE_PROMPT,
    mode === 'final' && FINAL_PROMPT,
  ]
    .filter(Boolean)
    .join('\n\n')
  const user = `${context}${terms}${clip}`
  const fullUser = `${earlierHeader}${earlierLines.join('')}${earlier.length ? '\n' : ''}${user}`
  const post = (
    baseUrl: string,
    apiKey: string | undefined,
    model: string,
    signal: AbortSignal,
    // Groq-only: keeps the reasoning out of the reply.
    extra: Record<string, unknown> = {},
    effort: 'low' | 'medium' = 'low',
    // Groq gets only the recent clips: its token limits are per minute.
    content: string = fullUser
  ) =>
    // Groq goes direct first, through this site's server if that is slow
    groqFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens:
          // Room for a joined question ("YES: ...") and the reasoning
          300 +
          (isReasoningModel(model) ? (effort === 'medium' ? 1500 : 300) : 0),
        ...(isReasoningModel(model)
          ? { reasoning_effort: effort, ...extra }
          : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
      }),
    })
  const groqBase = viaGroqProxy(
    groq.baseUrl || 'https://api.groq.com/openai/v1'
  )
  const request = (model: string) =>
    post(
      groqBase,
      groq.apiKey,
      model,
      controller.signal,
      { include_reasoning: false },
      'low',
      user
    )
  /** A Groq or Cerebras response, or Claude's reply text. */
  type Judged = { res: Response; model: string; text?: string }
  const groqJudge = async (): Promise<Judged> => {
    // Groq 120b skips 20b; a model Groq stopped serving stays skipped.
    if (groq.judge === 'groq-120b') {
      workingModel = Math.max(
        workingModel,
        CLASSIFIER_MODELS.indexOf('openai/gpt-oss-120b')
      )
    }
    let model = CLASSIFIER_MODELS[workingModel]
    let res = await request(model)
    while (res.status === 404 && workingModel < CLASSIFIER_MODELS.length - 1) {
      workingModel++
      model = CLASSIFIER_MODELS[workingModel]
      res = await request(model)
    }
    return { res, model }
  }
  // Cerebras first when it has a key. A failure falls back to Groq; if
  // Cerebras is slow, Groq is asked as well and the first answer wins. The
  // reason Cerebras lost goes in the check note (and the speaker log).
  const cerebrasOwn = new AbortController()
  const think = groq.judge === 'cerebras-120b-think'
  const cerebrasTimeout = think ? THINK_TIMEOUT_MS : CEREBRAS_TIMEOUT_MS
  const cerebras = async (): Promise<Judged | { why: string }> => {
    const cut = setTimeout(() => cerebrasOwn.abort(), cerebrasTimeout)
    try {
      const res = await post(
        groq.cerebras?.baseUrl || 'https://api.cerebras.ai/v1',
        groq.cerebras?.apiKey,
        CEREBRAS_CLASSIFIER_MODEL,
        cerebrasOwn.signal,
        {},
        think ? 'medium' : 'low'
      )
      if (res.ok)
        return {
          res,
          model: `cerebras/${CEREBRAS_CLASSIFIER_MODEL}${think ? ' (medium)' : ''}`,
        }
      const body = await res.text?.().catch(() => '')
      const detail = (body ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
      return {
        why: `Cerebras failed (${res.status})${detail ? `: ${detail}` : ''}`,
      }
    } catch {
      return {
        why: cerebrasOwn.signal.aborted
          ? `Cerebras gave no answer in ${cerebrasTimeout / 1000} s`
          : "Couldn't reach Cerebras",
      }
    } finally {
      clearTimeout(cut)
    }
  }
  const hedgeMs = think ? THINK_HEDGE_MS : CEREBRAS_HEDGE_MS
  const cerebrasFirst = async (): Promise<Judged & { note?: string }> => {
    const judge = groq.judge ?? 'cerebras-120b'
    const onCerebras =
      judge === 'cerebras-120b' || think || judge in CLAUDE_JUDGES
    if (!onCerebras || !groq.cerebras?.apiKey) return groqJudge()
    const first = cerebras()
    let hedge: ReturnType<typeof setTimeout> | undefined
    const early = await Promise.race([
      first,
      new Promise<'slow'>((resolve) => {
        hedge = setTimeout(() => resolve('slow'), hedgeMs)
      }),
    ])
    clearTimeout(hedge)
    if (early !== 'slow') {
      if ('res' in early) return early
      return { ...(await groqJudge()), note: early.why }
    }
    // Cerebras is slow: ask Groq too and take the first good answer.
    const second = groqJudge()
    const settled = await new Promise<Judged & { note?: string }>(
      (resolve, reject) => {
        let cerebrasWhy: string | undefined
        let groqDone: Judged | undefined
        let groqFailed: unknown
        const finishIfBoth = () => {
          if (cerebrasWhy === undefined) return
          if (groqDone) resolve({ ...groqDone, note: cerebrasWhy })
          else if (groqFailed !== undefined) reject(groqFailed)
        }
        first.then((c) => {
          if ('res' in c) return resolve(c)
          cerebrasWhy = c.why
          finishIfBoth()
        })
        second.then(
          (g) => {
            if (g.res.ok) {
              resolve({
                ...g,
                note: `Cerebras slower than ${hedgeMs / 1000} s; Groq answered first`,
              })
            } else {
              groqDone = g
              finishIfBoth()
            }
          },
          (err) => {
            groqFailed = err ?? new Error('Groq failed')
            finishIfBoth()
          }
        )
      }
    )
    // Stop whichever request lost.
    if (settled.model.startsWith('cerebras/')) controller.abort()
    else cerebrasOwn.abort()
    return settled
  }
  // Claude judges: the Anthropic Messages API straight from the browser. A
  // failure, or no answer within CLAUDE_HEDGE_MS, brings in Cerebras (then
  // Groq) and the first answer wins.
  const claudeModel = CLAUDE_JUDGES[groq.judge ?? 'cerebras-120b']
  const claudeOwn = new AbortController()
  const claude = async (): Promise<Judged | { why: string }> => {
    const cut = setTimeout(() => claudeOwn.abort(), CLAUDE_TIMEOUT_MS)
    const base = (groq.anthropic?.baseUrl || 'https://api.anthropic.com')
      .replace(/\/+$/, '')
      .replace(/\/v1$/, '')
    try {
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        signal: claudeOwn.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': groq.anthropic?.apiKey ?? '',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: claudeModel,
          max_tokens: 300,
          // Sonnet 5.5 rejects sampling settings and needs thinking turned
          // off this way; Haiku 4.5 runs without thinking by default.
          ...(claudeModel === 'claude-sonnet-5-5'
            ? {
                thinking: { type: 'between_tools' },
                output_config: { effort: 'low' },
              }
            : { temperature: 0 }),
          system: [
            {
              type: 'text',
              text: system,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            {
              role: 'user',
              content: [
                ...(earlier.length
                  ? earlierLines.map((text, i) => ({
                      type: 'text',
                      text: i === 0 ? `${earlierHeader}${text}` : text,
                      ...(i === earlierLines.length - 1
                        ? { cache_control: { type: 'ephemeral' } }
                        : {}),
                    }))
                  : []),
                { type: 'text', text: user },
              ],
            },
          ],
        }),
      })
      if (!res.ok) {
        const body = await res.text?.().catch(() => '')
        const detail = (body ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
        return {
          why: `Claude failed (${res.status})${detail ? `: ${detail}` : ''}`,
        }
      }
      const data = (await res.json()) as {
        content?: { type: string; text?: string }[]
      }
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')
      return { res, model: `anthropic/${claudeModel}`, text }
    } catch {
      return {
        why: claudeOwn.signal.aborted
          ? `Claude gave no answer in ${CLAUDE_TIMEOUT_MS / 1000} s`
          : "Couldn't reach Claude",
      }
    } finally {
      clearTimeout(cut)
    }
  }
  const judgeOnce = async (): Promise<Judged & { note?: string }> => {
    if (!claudeModel || !groq.anthropic?.apiKey) {
      const judged = await cerebrasFirst()
      return claudeModel
        ? withJudgedNote(judged, 'No Anthropic key; used Cerebras')
        : judged
    }
    const first = claude()
    let hedge: ReturnType<typeof setTimeout> | undefined
    const early = await Promise.race([
      first,
      new Promise<'slow'>((resolve) => {
        hedge = setTimeout(() => resolve('slow'), CLAUDE_HEDGE_MS)
      }),
    ])
    clearTimeout(hedge)
    if (early !== 'slow') {
      if ('res' in early) return early
      return withJudgedNote(await cerebrasFirst(), early.why)
    }
    // Claude is slow: ask Cerebras too and take the first good answer.
    const backup = cerebrasFirst().then(
      (j): (Judged & { note?: string }) | undefined =>
        j.res.ok
          ? withJudgedNote(
              j,
              `Claude slower than ${CLAUDE_HEDGE_MS / 1000} s; ${j.model} answered first`
            )
          : undefined,
      () => undefined
    )
    const winner = await new Promise<Judged & { note?: string }>(
      (resolve, reject) => {
        let left = 2
        let claudeWhy: string | undefined
        const miss = () => {
          if (--left) return
          reject(
            new RelevanceCheckError(
              `${claudeWhy ?? 'Claude failed'}; Cerebras and Groq failed too`
            )
          )
        }
        first.then((c) => {
          if ('res' in c) resolve(c)
          else {
            claudeWhy = c.why
            miss()
          }
        })
        backup.then((b) => (b ? resolve(b) : miss()))
      }
    )
    if (winner.model.startsWith('anthropic/')) {
      controller.abort()
      cerebrasOwn.abort()
    } else claudeOwn.abort()
    return winner
  }
  try {
    const { res, model, note, text } = await judgeOnce()
    if (!res.ok) {
      throw new RelevanceCheckError(
        res.status === 429
          ? 'Groq rate limit reached (429); questions are not being sent'
          : `Groq check failed (${res.status}); questions are not being sent`
      )
    }
    const reply =
      text ??
      (
        (await res.json()) as {
          choices?: { message?: { content?: string } }[]
        }
      ).choices?.[0]?.message?.content ??
      ''
    // The judge's reason, on its own line, goes in the log, not the question.
    const [answer, why] = splitWhy(reply)
    const [verdict, type] = clipTypes ? splitType(answer) : [answer, '']
    // A skip type drops a YES. WAIT and MORE keep their meaning, and a NO
    // stays a NO whatever the type.
    const said = /^\s*(yes|no|wait|more)\b/i.exec(verdict)?.[1].toLowerCase()
    const vetoed = sendsType(type) === false && said === 'yes'
    const notes = [
      note,
      type && `type: ${type}${vetoed ? ' (overrode yes)' : ''}`,
      why && `why: ${why}`,
    ]
      .filter(Boolean)
      .join('; ')
    onCheck?.({
      model,
      ms: Date.now() - started,
      ...(notes ? { note: notes } : {}),
      ...(type ? { type } : {}),
    })
    if (allowWait && said === 'wait') return { wait: texts[0] }
    // The clip continues the question just sent: send them joined, as long
    // as the joined wording still has the clip's words
    const more = /^\s*more\b[\s:.,-]*([\s\S]*)$/i.exec(verdict)
    if (more) {
      const joined = more[1]
        .trim()
        .replace(/^"(.*)"$/s, '$1')
        .trim()
      if (joined && texts.some((t) => keepsWords(joined, t)))
        return { more: joined }
    }
    if (vetoed) return null
    const yes = more ?? /^\s*yes\b[\s:.,-]*([\s\S]*)$/i.exec(verdict)
    if (!yes) return null
    const merged = yes[1]
      .trim()
      .replace(/^"(.*)"$/s, '$1')
      .trim()
    // Guard against the model answering instead of copying the clip, or
    // cutting a question down to its last sentence (dropping the setup).
    // The judge may join recent clips (setup, or the question an addition
    // belongs to) to this one.
    const joined = last.reduce((n, r) => n + r.text.length + 1, 0)
    const longest = Math.max(...texts.map((t) => t.length))
    const shortest = Math.min(...texts.map((t) => t.length))
    const fits =
      !!merged &&
      merged.length <= (longest + joined) * 1.5 + 20 &&
      merged.length >= shortest * MIN_MERGED_SHARE
    // Without a usable wording, send the transcript with the most key terms
    // (07 Oct: a bare YES sent "integrate Gemstone with Jenkins" while Grok
    // had heard "JMeter")
    const heard = withMostKeyTerms(texts, groq.keyterms ?? [])
    if (!fits) return heard
    if (merge || groq.coding) return merged
    // One transcript: only a join is allowed, so the clip's own words must
    // all still be there and something must have been added.
    return merged.length > texts[0].length && keepsWords(merged, texts[0])
      ? merged
      : heard
  } catch (err) {
    if (err instanceof RelevanceCheckError) throw err
    throw new RelevanceCheckError(
      "Couldn't reach Groq; questions are not being sent"
    )
  } finally {
    clearTimeout(timer)
  }
}

export function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Picks the text to send for a clip, or null to drop it. `texts` holds each
 * engine's transcript (ElevenLabs first). The Groq model decides, using the last few
 * clips so follow-ups count, and merges the two transcripts when they differ.
 * Without a Groq key only clear questions of 5+ words pass the local check;
 * if Groq can't be reached it throws RelevanceCheckError and nothing is sent.
 */
export async function pickRelevant(
  texts: string[],
  groq?: GroqConfig,
  recent: RecentClip[] = [],
  onCheck?: (info: CheckInfo) => void,
  mode: JudgeMode = 'plain'
): Promise<Verdict> {
  const distinct = distinctTranscripts(texts).slice(0, 2)
  if (!distinct.length) return null
  // Plain chatter ("Okay, okay.", "Can you hear me?") is dropped here, so the
  // question after it doesn't wait behind a judge call.
  const reasons = distinct.map(chatterReason)
  if (reasons.every(Boolean)) {
    onCheck?.({
      model: 'local chatter rule',
      ms: 0,
      note: `Skipped: ${reasons[0]}`,
    })
    return null
  }
  if (!groq?.apiKey && !groq?.cerebras?.apiKey && !groq?.anthropic?.apiKey) {
    onCheck?.({ model: 'local rule (no Groq key)', ms: 0 })
    const text = distinct[0]
    return wordCount(text) >= 5 && looksLikeQuestion(text) ? text : null
  }
  const second = groq.secondJudge
  if (!second || second === (groq.judge ?? 'cerebras-120b'))
    return classifyWithGroq(distinct, recent, groq, onCheck, mode)
  return withSecondOpinion(distinct, recent, groq, second, onCheck, mode)
}

/** Settings > General: the second judge, or off (the default). */
export const SECOND_JUDGE_STORAGE_KEY = 'speaker-second-judge'

export function getSecondJudge(): JudgeModel | undefined {
  try {
    const saved = localStorage.getItem(SECOND_JUDGE_STORAGE_KEY)
    return JUDGE_MODELS.find((m) => m.value === saved)?.value
  } catch {
    return undefined
  }
}

export function setSecondJudge(model: JudgeModel | undefined) {
  try {
    if (model) localStorage.setItem(SECOND_JUDGE_STORAGE_KEY, model)
    else localStorage.removeItem(SECOND_JUDGE_STORAGE_KEY)
  } catch {
    // Storage blocked: the default stays in effect
  }
}

/**
 * Both judges at once. Agreement decides as one judge would; when one would
 * send and the other would not, the clip is offered as a suggestion. The
 * first judge alone decides a WAIT or MORE, and if the second one fails.
 */
async function withSecondOpinion(
  texts: string[],
  recent: RecentClip[],
  groq: GroqConfig,
  second: JudgeModel,
  onCheck: ((info: CheckInfo) => void) | undefined,
  mode: JudgeMode
): Promise<Verdict> {
  let firstInfo: CheckInfo | undefined
  let secondInfo: CheckInfo | undefined
  const [a, b] = await Promise.all([
    classifyWithGroq(texts, recent, groq, (i) => (firstInfo = i), mode),
    classifyWithGroq(
      texts,
      recent,
      { ...groq, judge: second },
      (i) => (secondInfo = i),
      mode
    ).catch(() => undefined),
  ])
  const sends = (v: Verdict | undefined) =>
    typeof v === 'string' || (!!v && isMore(v))
  const agree = b === undefined || isWait(a) || sends(a) === sends(b)
  // The wording of whichever judge would send it
  const wording = (v: Verdict | undefined) =>
    typeof v === 'string' ? v : v && isMore(v) ? v.more : null
  const verdict: Verdict = agree
    ? a
    : { unsure: wording(a) ?? wording(b) ?? texts[0] }
  if (firstInfo) {
    const other =
      b === undefined
        ? 'second judge failed'
        : `second judge ${secondInfo?.model ?? second}${secondInfo ? ` ${(secondInfo.ms / 1000).toFixed(1)} s` : ''} said ${sends(b) ? 'yes' : 'no'}`
    onCheck?.(
      withNote(
        firstInfo,
        agree ? other : `Judges disagree (${other}): offered to tap`
      )
    )
  }
  return verdict
}

/** A clip heard earlier, and whether it was sent to the chat. */
export type RecentClip = {
  text: string
  sent: boolean
  /** When it was heard (ms), kept by the filter. */
  at?: number
  /** Seconds since it was heard, shown to the judge. */
  ago?: number
}

/** How long a sent question counts when checking for repeats. */
export const REPEAT_WINDOW_MS = 2 * 60 * 1000

/**
 * True when most words of `text` (80%+) also appear in `earlier`, e.g. the
 * speaker repeating the end of a question that was just sent. Clips under four
 * words ("Why?", "And then?") are left to the classifier as follow-ups.
 */
const MIN_REPEAT_WORDS = 8

export function isRepeatOf(text: string, earlier: string): boolean {
  const words = normalize(text).split(' ').filter(Boolean)
  // Short follow-ups ("Why is that? Can you explain?") share most of their
  // words with many questions, so they are left to the classifier
  if (words.length < MIN_REPEAT_WORDS) return false
  const pool = new Map<string, number>()
  for (const w of normalize(earlier).split(' ')) {
    if (w) pool.set(w, (pool.get(w) ?? 0) + 1)
  }
  let found = 0
  for (const w of words) {
    const left = pool.get(w) ?? 0
    if (left) {
      found++
      pool.set(w, left - 1)
    }
  }
  return found / words.length >= 0.8
}

/**
 * "Wait for the rest of a question", switched in Settings > General: the judge
 * may hold a clip that breaks off mid-question (or an interviewer's lead-in)
 * and join it to the next one. Kept in this browser; off by default.
 */
export const WAIT_MODE_STORAGE_KEY = 'speaker-wait-mode'

export function getWaitMode(): boolean {
  try {
    return localStorage.getItem(WAIT_MODE_STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function setWaitMode(on: boolean) {
  try {
    localStorage.setItem(WAIT_MODE_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Storage blocked: waiting stays off
  }
}

/** The send-the-scenario key joins at most this many clips. */
export const SCENARIO_MAX_CLIPS = 20

/** How long a held clip waits for the speaker to carry on. */
export const HOLD_MS = 4000
/** While the speaker keeps talking the wait is extended, up to this long. */
export const MAX_HOLD_MS = 20000

export type HoldOptions = {
  /** Whether the judge may answer WAIT (read for every clip). */
  enabled: () => boolean
  /** True while the speaker is talking or a clip is being transcribed. */
  busy?: () => boolean
  /** A held clip nothing followed, judged again on its own. */
  onLate?: (clip: { text: string; sent: boolean; check?: CheckInfo }) => void
  holdMs?: number
  /**
   * Smart Turn decides (read for every clip): a question the judge would
   * send is held while the speaker sounds mid-turn (see smartTurn.ts).
   */
  smartTurn?: () => boolean
  /** The judges disagreed on this clip: offer it to send with one tap. */
  onUnsure?: (text: string) => void
}

/**
 * Keeps the last few clips heard so the classifier can judge follow-ups, and
 * skips a clip that repeats a question sent in the last two minutes. With
 * `hold`, an unfinished question is held and joined to the next clip; if
 * nothing follows it is judged again alone and sent late through `onLate`.
 */
export function createRelevanceFilter(
  getGroq: () => GroqConfig | undefined,
  onCheck?: (info: CheckInfo) => void,
  now: () => number = Date.now,
  hold?: HoldOptions
) {
  const recent: RecentClip[] = []
  const sent: { text: string; at: number }[] = []
  let held: {
    text: string
    at: number
    /** When this hold began (a joined clip keeps `at`). */
    since: number
    timer: ReturnType<typeof setTimeout>
    /** Already judged: sent as it is when nothing joins it. */
    ready?: string
  } | null = null
  let stopped = false
  /** Clips heard since the last one sent, for the send-the-scenario key. */
  let sinceSent: string[] = []
  /** Questions that take in the one sent just before (see takeRevision). */
  const revisions = new Set<string>()

  // The judge joined this clip to the question sent just before it (a detail
  // added, or the same question asked again): the chat should answer the
  // joined question instead of the earlier one, not as well as it.
  const continuesLastSent = () =>
    sent.length > 0 && now() - sent[sent.length - 1].at <= JOIN_WINDOW_S * 1000
  const revises = (text: string) => {
    const prev = sent[sent.length - 1]
    const yes =
      !!prev &&
      now() - prev.at <= JOIN_WINDOW_S * 1000 &&
      text.length > prev.text.length &&
      keepsWords(text, prev.text)
    if (yes) revisions.add(text)
    return yes
  }

  const remember = (text: string, wasSent: boolean) => {
    recent.push({ text, sent: wasSent, at: now() })
    if (recent.length > HISTORY_CLIPS) recent.shift()
    if (wasSent) sinceSent = []
    else if (text) sinceSent = [...sinceSent, text].slice(-SCENARIO_MAX_CLIPS)
  }
  // What the judge sees: the recent clips with how long ago each was heard.
  const context = (): RecentClip[] =>
    recent.map((r) => ({
      text: r.text,
      sent: r.sent,
      ...(r.at !== undefined
        ? { at: r.at, ago: Math.round((now() - r.at) / 1000) }
        : {}),
    }))

  // Nothing joined the held clip in time: judge it as it stands.
  const release = async (force = false) => {
    const clip = held
    held = null
    if (!clip || stopped) return
    if (!force && hold?.busy?.() && now() - clip.at < MAX_HOLD_MS) {
      held = { ...clip, timer: setTimeout(release, 1000) }
      return
    }
    let check: CheckInfo | undefined
    let text: string | null = null
    if (clip.ready) {
      text = clip.ready
      check = {
        model: 'smart turn',
        ms: 0,
        note: force
          ? 'Sent when you started speaking'
          : 'Sent after the speaker stopped',
      }
    } else {
      try {
        const verdict = await pickRelevant(
          [clip.text],
          getGroq(),
          context(),
          (info) => (check = info),
          'final'
        )
        if (isUnsure(verdict)) hold?.onUnsure?.(verdict.unsure)
        text = isMore(verdict)
          ? verdict.more
          : typeof verdict === 'string'
            ? verdict
            : null
        if (isMore(verdict) && continuesLastSent()) revisions.add(verdict.more)
        if (check) check = withNote(check, 'Judged alone after waiting')
      } catch (err) {
        check = { model: 'wait', ms: 0, note: (err as Error).message }
      }
    }
    if (stopped) return
    remember(clip.text, text !== null)
    if (text && (revisions.has(text) || revises(text)) && check)
      check = withNote(check, 'Replaces the question just sent')
    if (text) sent.push({ text, at: now() })
    hold?.onLate?.({ text: text ?? clip.text, sent: text !== null, check })
  }

  const accept = async (texts: string[], turn?: TurnCheck | null) => {
    const joining = held
    if (joining) {
      clearTimeout(joining.timer)
      held = null
    }
    // A question held while the speaker sounded mid-turn was already judged:
    // the next clip is judged on its own, after it, so an answer that follows
    // is never glued on (the question then goes out alone, at once)
    const ready = joining?.ready
    const parts =
      joining && !ready ? texts.map((t) => `${joining.text} ${t}`) : texts
    const withReady = (t: string) =>
      ready && !t.includes(ready) ? `${ready} ${t}` : t
    let last: CheckInfo | undefined
    const report = (info: CheckInfo) => {
      last = info
      onCheck?.(info)
    }
    let text: string | null = null
    let waiting = false
    try {
      const cutoff = now() - REPEAT_WINDOW_MS
      while (sent.length && sent[0].at < cutoff) sent.shift()
      if (texts.some((t) => sent.some((s) => isRepeatOf(t, s.text)))) {
        report({
          model: 'repeat check',
          ms: 0,
          note: 'Skipped: repeats a question just sent',
        })
        if (ready) {
          text = ready
          sent.push({ text, at: now() })
        }
        return text
      }
      const verdict = await pickRelevant(
        parts,
        getGroq(),
        ready && joining
          ? [
              ...context(),
              {
                text: ready,
                sent: true,
                at: joining.since,
                ago: Math.round((now() - joining.since) / 1000),
              },
            ]
          : context(),
        report,
        hold?.enabled() ? 'wait' : 'plain'
      )
      if (isWait(verdict)) {
        waiting = true
        held = {
          text: withReady(verdict.wait),
          at: joining?.at ?? now(),
          since: now(),
          timer: setTimeout(release, hold?.holdMs ?? HOLD_MS),
          // If nothing completes it, the question still goes out
          ...(ready ? { ready } : {}),
        }
        if (last)
          onCheck?.(withNote(last, 'Waiting for the rest of the question'))
        return null
      }
      if (isUnsure(verdict)) {
        // Not sent: offered instead (a held question still goes out below)
        hold?.onUnsure?.(withReady(verdict.unsure))
        text = null
      } else if (isMore(verdict)) {
        text = withReady(verdict.more)
        if (continuesLastSent()) revisions.add(text)
      } else text = verdict && withReady(verdict)
      // The judge would send it, but the speaker sounds mid-sentence: hold it
      // so the rest joins it (never past MAX_HOLD_MS from the first part)
      if (
        text &&
        hold?.smartTurn?.() &&
        turn &&
        turn.probability < SMART_TURN_HOLD_BELOW &&
        now() - (joining?.at ?? now()) < MAX_HOLD_MS
      ) {
        waiting = true
        held = {
          text,
          ready: text,
          at: joining?.at ?? now(),
          since: now(),
          timer: setTimeout(release, SMART_TURN_HOLD_MS),
        }
        if (last)
          onCheck?.(withNote(last, 'Speaker mid-turn: waiting for the rest'))
        return null
      }
      // The next clip wasn't part of the held question: send the question alone
      if (!text && ready) {
        text = ready
        const note = 'Sent the question held before this clip'
        onCheck?.(
          last ? withNote(last, note) : { model: 'smart turn', ms: 0, note }
        )
      } else if (joining && last)
        onCheck?.(withNote(last, 'Joined with the clip before'))
      if (text && (revisions.has(text) || revises(text)) && last)
        onCheck?.(withNote(last, 'Replaces the question just sent'))
      if (text) sent.push({ text, at: now() })
      return text
    } finally {
      if (!waiting) remember(text ?? parts[0] ?? '', text !== null)
    }
  }

  return Object.assign(accept, {
    /** True (once) when a sent text replaces the question sent before it. */
    takeRevision(text: string): boolean {
      return revisions.delete(text)
    },
    /**
     * Everything heard since the last sent question (skipped and held clips
     * too), joined in order and counted as sent; null when there is none.
     */
    takeScenario(): string | null {
      const parts = [...sinceSent]
      if (held) {
        clearTimeout(held.timer)
        parts.push(held.text)
        held = null
      }
      const text = parts.join(' ').replace(/\s+/g, ' ').trim()
      if (!text) return null
      remember(text, true)
      sent.push({ text, at: now() })
      return text
    },
    /** A suggestion you sent with one tap: counts as sent from now on. */
    markSent(text: string) {
      remember(text, true)
      sent.push({ text, at: now() })
    },
    /** True while a clip is held for the rest of the question. */
    holding: () => held !== null,
    /** When the current hold began, or null. */
    heldSince: () => held?.since ?? null,
    /** Ends the hold now (you started answering), as if its time ran out. */
    flush(): Promise<void> {
      if (!held) return Promise.resolve()
      clearTimeout(held.timer)
      return release(true)
    },
    /** Drops a held clip; call when listening stops. */
    stop() {
      stopped = true
      if (held) clearTimeout(held.timer)
      held = null
    },
  })
}
