import {
  CLASSIFIER_PROMPT,
  CODING_PROMPT,
  createRelevanceFilter,
  getClipTypes,
  HOLD_MS,
  INTERVIEW_PROMPT,
  isRepeatOf,
  JOIN_PROMPT,
  MERGE_PROMPT,
  WAIT_PROMPT,
  type GroqConfig,
} from './speakerFilter'

/**
 * Replays the labelled clips from real interviews (labeled.jsonl, added to by
 * the daily labelling routine) through the whole speaker filter, in order,
 * with its history, repeat check, holds and joins, and scores what it would
 * send against the labels. Run before and after a pipeline change to see
 * whether it helps: chatter sent and questions missed, beside what the live
 * judge did when the clips were heard.
 */

export type LabeledClip = {
  at: string
  text: string
  coding: boolean
  /** What the live judge did when the clip was heard. */
  judge_sent: boolean
  label: 'send' | 'skip'
}

/** A gap this long starts a new interview, with a fresh filter. */
export const SESSION_GAP_MS = 30 * 60 * 1000
/** Interviews replayed at the same time. */
const PARALLEL_SESSIONS = 3

export function parseLabeled(jsonl: string): LabeledClip[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LabeledClip)
}

export function splitSessions(
  clips: LabeledClip[],
  gapMs = SESSION_GAP_MS
): LabeledClip[][] {
  const sessions: LabeledClip[][] = []
  let last = -Infinity
  for (const clip of clips) {
    const at = Date.parse(clip.at)
    if (at - last > gapMs || !sessions.length) sessions.push([])
    sessions[sessions.length - 1].push(clip)
    last = at
  }
  return sessions
}

export type ReplayScore = {
  /** Clips labelled skip that were sent. */
  chatterSent: LabeledClip[]
  /** Clips labelled send that were not. */
  missed: LabeledClip[]
}

export function scoreSent(clips: LabeledClip[], sent: boolean[]): ReplayScore {
  return {
    chatterSent: clips.filter((c, i) => sent[i] && c.label === 'skip'),
    missed: clips.filter((c, i) => !sent[i] && c.label === 'send'),
  }
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Every quoted example in the judge's instructions, normalized. */
export function promptExamples(
  prompts: string[] = [
    CLASSIFIER_PROMPT,
    INTERVIEW_PROMPT,
    WAIT_PROMPT,
    CODING_PROMPT,
    JOIN_PROMPT,
    MERGE_PROMPT,
  ]
): string[] {
  const quotes = prompts.flatMap((p) =>
    [...p.matchAll(/"([^"\n]+)"/g)].map((m) => normalize(m[1]))
  )
  return [...new Set(quotes)].filter((q) => q.split(' ').length >= 3)
}

/**
 * True when the clip (or a good part of it) is quoted in the judge's
 * instructions. The judge was shown the answer for those clips, so they say
 * nothing about how it does on interviews it hasn't seen.
 */
export function isPromptExample(text: string, examples: string[]): boolean {
  const clip = normalize(text)
  if (!clip) return false
  return examples.some(
    (e) => clip.includes(e) || (clip.split(' ').length >= 3 && e.includes(clip))
  )
}

/** How many wrong clips the judge gave each type ('none' when it named none). */
export function countTypes(
  clips: LabeledClip[],
  typeOf: Map<LabeledClip, string>
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const c of clips) {
    const t = typeOf.get(c) || 'none'
    counts[t] = (counts[t] ?? 0) + 1
  }
  return counts
}

/**
 * Stretches of the log that were not an interview (a team call in Telugu and
 * English on 06 Oct), left out of the replay.
 */
export const NOT_INTERVIEWS: [string, string][] = [
  ['2026-10-06T14:00:00', '2026-10-06T15:00:00'],
]

/**
 * A clip this long ago that says the same as a later one means the later one
 * is a recording played again for testing, not the interviewer repeating.
 */
const REPLAYED_AFTER_MS = 5 * 60 * 1000

/**
 * The clips the replay scores: everything but stretches that were not an
 * interview, and clips of recordings played again for testing (the same
 * mock interview was played several times on 05 Oct). Scoring a replayed
 * question again counts the repeat check's skip as a missed question.
 */
export function benchClips(clips: LabeledClip[]): LabeledClip[] {
  const kept: LabeledClip[] = []
  for (const clip of clips) {
    if (NOT_INTERVIEWS.some(([from, to]) => clip.at >= from && clip.at < to))
      continue
    const at = Date.parse(clip.at)
    const replayed = kept.some(
      (k) =>
        at - Date.parse(k.at) >= REPLAYED_AFTER_MS &&
        isRepeatOf(clip.text, k.text) &&
        isRepeatOf(k.text, clip.text)
    )
    if (!replayed) kept.push(clip)
  }
  return kept
}

/** Pieces of a question this close together can be joined into one row. */
const JOIN_ROW_MS = 60_000

/**
 * The live log stores a question asked in pieces three ways: each piece, and
 * the joined question as a row of its own ("Can you tell me the...",
 * "HTTP methods.", "Can you tell me the... HTTP methods."). Returns each joined
 * row's index with the indices of its pieces, so the replay doesn't count the
 * pieces as chatter sent and the joined row as a missed repeat.
 */
export function joinedRows(clips: LabeledClip[]): Map<number, number[]> {
  const squash = (t: string) => t.replace(/\s+/g, '')
  const rows = new Map<number, number[]>()
  clips.forEach((clip, i) => {
    for (let k = 2; k <= 4 && i - k >= 0; k++) {
      const pieces = clips.slice(i - k, i)
      if (Date.parse(clip.at) - Date.parse(pieces[0].at) > JOIN_ROW_MS) break
      // The joined row may carry a little more ("... It's a postman.")
      if (
        squash(clip.text).startsWith(squash(pieces.map((p) => p.text).join('')))
      ) {
        rows.set(
          i,
          pieces.map((_, j) => i - k + j)
        )
        break
      }
    }
  })
  return rows
}

type SessionRun = {
  /** Clips the two judges disagreed on, offered as a chip instead. */
  offered: boolean[]
  /** Pieces of a joined row: scored through that row instead. */
  parts: boolean[]
  types: string[]
  sent: boolean[]
  ms: number[]
  held: number
  errors: string[]
}

/**
 * One interview through a fresh filter. The clock follows the clips' times;
 * a held clip is released once the next clip is HOLD_MS or more away, as
 * its timer would have done live.
 */
export async function replaySession(
  clips: LabeledClip[],
  config: GroqConfig,
  wait: boolean,
  onClip?: () => void
): Promise<SessionRun> {
  let clock = Date.parse(clips[0]?.at ?? '') || 0
  let current: LabeledClip | undefined
  let currentIndex = -1
  const sent = clips.map(() => false)
  const types = clips.map(() => '')
  const offered = clips.map(() => false)
  const joined = joinedRows(clips)
  const parts = clips.map(() => false)
  for (const pieces of joined.values()) for (const p of pieces) parts[p] = true
  const ms: number[] = []
  const errors: string[] = []
  let held = 0
  // Clips held so far, sent or dropped with whatever they join
  let pending: number[] = []
  const settle = (wasSent: boolean, also: number[] = []) => {
    if (wasSent) for (const i of [...pending, ...also]) sent[i] = true
    pending = []
  }
  const filter = createRelevanceFilter(
    () => ({ ...config, coding: current?.coding ?? false }),
    (info) => {
      if (info.ms > 0) ms.push(info.ms)
      if (info.type && currentIndex >= 0) types[currentIndex] = info.type
    },
    () => clock,
    {
      enabled: () => wait,
      // Released by the replay instead (below)
      holdMs: 1_000_000_000,
      onLate: (clip) => settle(clip.sent),
      onUnsure: () => {
        if (currentIndex >= 0) offered[currentIndex] = true
      },
    }
  )
  try {
    for (const [i, clip] of clips.entries()) {
      const at = Date.parse(clip.at)
      const since = filter.heldSince()
      if (since !== null && at - since >= HOLD_MS) {
        clock = since + HOLD_MS
        await filter.flush()
      }
      // The joined row was heard as its pieces; it is scored from them below
      if (joined.has(i)) {
        onClip?.()
        continue
      }
      clock = at
      current = clip
      currentIndex = i
      try {
        const text = await filter([clip.text])
        if (text) settle(true, [i])
        else if (filter.holding()) {
          pending.push(i)
          held++
        } else settle(false)
      } catch (err) {
        errors.push(`${clip.at} ${(err as Error).message}`)
        settle(false)
      }
      onClip?.()
    }
    if (filter.holding()) {
      clock = (filter.heldSince() ?? clock) + HOLD_MS
      await filter.flush()
    }
  } finally {
    filter.stop()
  }
  for (const [i, pieces] of joined) {
    sent[i] = pieces.some((p) => sent[p])
    offered[i] = pieces.some((p) => offered[p])
    types[i] = types[pieces[pieces.length - 1]]
  }
  return { offered, parts, types, sent, ms, held, errors }
}

/** Offered clips that were real questions, and those that were chatter. */
export type Offered = { questions: number; chatter: number }

const countOffered = (clips: LabeledClip[], offered: boolean[]): Offered => ({
  questions: clips.filter((c, i) => offered[i] && c.label === 'send').length,
  chatter: clips.filter((c, i) => offered[i] && c.label === 'skip').length,
})

export type ReplayResult = {
  clips: number
  sessions: number
  sends: number
  wait: boolean
  /** Whether the judge named clip types (Settings > Clip types). */
  clipTypes: boolean
  judge: string
  /** The second judge, or 'off'. */
  second: string
  now: ReplayScore
  live: ReplayScore
  /**
   * The same scores for clips not quoted in the judge's instructions: the
   * honest measure, since the judge was never shown their answer.
   */
  unseen: {
    clips: number
    sends: number
    now: ReplayScore
    live: ReplayScore
    offered: Offered
  }
  /** Clips offered as a chip (second judge on): not sent, nor counted as sent. */
  offered: Offered
  /** Wrong clips by the type the judge named. */
  types: {
    chatterSent: Record<string, number>
    missed: Record<string, number>
  }
  medianMs: number
  slowestMs: number
  held: number
  errors: string[]
}

/** Replays every interview (a few at a time) and scores the result. */
export async function replayLabeled(
  clips: LabeledClip[],
  config: GroqConfig,
  wait: boolean,
  onProgress?: (done: number, total: number) => void
): Promise<ReplayResult> {
  const sessions = splitSessions(benchClips(clips))
  const runs: SessionRun[] = new Array(sessions.length)
  let done = 0
  let next = 0
  const worker = async () => {
    while (next < sessions.length) {
      const s = next++
      runs[s] = await replaySession(sessions[s], config, wait, () =>
        onProgress?.(++done, clips.length)
      )
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_SESSIONS, sessions.length) }, worker)
  )
  // Pieces of a joined row are scored through that row
  const keep = runs.flatMap((r) => r.parts.map((part) => !part))
  const ordered = sessions.flat().filter((_, i) => keep[i])
  const sent = runs.flatMap((r) => r.sent).filter((_, i) => keep[i])
  const types = runs.flatMap((r) => r.types).filter((_, i) => keep[i])
  const offered = runs.flatMap((r) => r.offered).filter((_, i) => keep[i])
  const typeOf = new Map(ordered.map((c, i) => [c, types[i]]))
  const ms = runs.flatMap((r) => r.ms).sort((a, b) => a - b)
  const examples = promptExamples()
  const unseenAt = ordered
    .map((c, i) => (isPromptExample(c.text, examples) ? -1 : i))
    .filter((i) => i >= 0)
  const unseen = unseenAt.map((i) => ordered[i])
  const now = scoreSent(ordered, sent)
  return {
    clips: ordered.length,
    sessions: sessions.length,
    sends: ordered.filter((c) => c.label === 'send').length,
    wait,
    clipTypes: config.clipTypes ?? getClipTypes(),
    judge: config.judge ?? 'cerebras-120b',
    second: config.secondJudge ?? 'off',
    now,
    live: scoreSent(
      ordered,
      ordered.map((c) => c.judge_sent)
    ),
    unseen: {
      clips: unseen.length,
      sends: unseen.filter((c) => c.label === 'send').length,
      now: scoreSent(
        unseen,
        unseenAt.map((i) => sent[i])
      ),
      live: scoreSent(
        unseen,
        unseen.map((c) => c.judge_sent)
      ),
      offered: countOffered(
        unseen,
        unseenAt.map((i) => offered[i])
      ),
    },
    offered: countOffered(ordered, offered),
    types: {
      chatterSent: countTypes(now.chatterSent, typeOf),
      missed: countTypes(now.missed, typeOf),
    },
    medianMs: ms[Math.floor(ms.length / 2)] ?? 0,
    slowestMs: ms[ms.length - 1] ?? 0,
    held: runs.reduce((n, r) => n + r.held, 0),
    errors: runs.flatMap((r) => r.errors),
  }
}

/** One line for the server log, so results can be compared over time. */
export function replaySummary(r: ReplayResult): string {
  return [
    `bench replay judge=${r.judge} second=${r.second} wait=${r.wait ? 'on' : 'off'} types=${r.clipTypes ? 'on' : 'off'}`,
    `clips=${r.clips} sessions=${r.sessions} sends=${r.sends}`,
    `chatter_sent=${r.now.chatterSent.length} (live ${r.live.chatterSent.length})`,
    `missed=${r.now.missed.length} (live ${r.live.missed.length})`,
    ...(r.offered.questions + r.offered.chatter
      ? [
          `offered questions=${r.offered.questions} chatter=${r.offered.chatter} (unseen ${r.unseen.offered.questions}/${r.unseen.offered.chatter})`,
        ]
      : []),
    `unseen clips=${r.unseen.clips} chatter_sent=${r.unseen.now.chatterSent.length} (live ${r.unseen.live.chatterSent.length}) missed=${r.unseen.now.missed.length} of ${r.unseen.sends} (live ${r.unseen.live.missed.length})`,
    `held=${r.held} judge_median=${(r.medianMs / 1000).toFixed(2)}s slowest=${(r.slowestMs / 1000).toFixed(2)}s errors=${r.errors.length}`,
  ].join(' | ')
}

/** The summary plus every wrong clip, for copying. */
export function formatReplay(r: ReplayResult): string {
  const list = (clips: LabeledClip[]) =>
    clips.map((c) => `- ${c.at} "${c.text}"`).join('\n')
  return [
    replaySummary(r),
    '',
    `Chatter sent by type: ${formatTypes(r.types.chatterSent)}`,
    `Questions missed by type: ${formatTypes(r.types.missed)}`,
    '',
    `Chatter sent (${r.now.chatterSent.length}):`,
    list(r.now.chatterSent),
    '',
    `Questions missed (${r.now.missed.length}):`,
    list(r.now.missed),
    ...(r.errors.length
      ? ['', 'Errors:', ...r.errors.map((e) => `- ${e}`)]
      : []),
  ].join('\n')
}

/** "logistics 12, repeat 4", most first. */
export function formatTypes(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} ${n}`)
  return parts.length ? parts.join(', ') : 'none'
}

/** The labelled clips shipped with the app (loaded only when the test runs). */
export async function loadLabeledClips(): Promise<LabeledClip[]> {
  const { default: jsonl } =
    await import('../../../scripts/speaker-classifier/labeled.jsonl?raw')
  return parseLabeled(jsonl)
}
