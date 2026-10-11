import type { TurnContext, TurnDecision } from './speakerTurnJudge'

export const QUESTION_SETTLE_MS = 500
export const UNFINISHED_TURN_SETTLE_MS = 1000
const MAX_DRAFT_CHARS = 24000

export type QuestionDraft = {
  id: string
  text: string
  complete: boolean
  manual: boolean
  uncertain?: boolean
  reason: string
}
export type QuestionCommit = {
  id: string
  version: number
  text: string
  relation: 'new' | 'update'
  origin?: 'automatic' | 'send-now' | 'suggestion'
}
type Options = {
  judge: (texts: string[], context: TurnContext) => Promise<TurnDecision>
  onDraft: (draft: QuestionDraft | null) => void
  onCommit: (turn: QuestionCommit) => void
  onSuggest: (text: string, reason?: string) => void
  settleMs?: number
  onTrace?: (event: string, fields: Record<string, unknown>) => void
}
const normalize = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
const append = (base: string, text: string) =>
  normalize(base).includes(normalize(text)) ? base : `${base} ${text}`.trim()

/** Sole authority for committing speech. Incomplete scenarios never expire into sends. */
export function createQuestionTurns(options: Options) {
  let draft: QuestionDraft | null = null
  let active: QuestionCommit | null = null
  let recent: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let processing = 0
  let hearing = false
  let quietSince: number | null = null
  let busy = false
  let stopped = false
  let epoch = 0
  let sequence = 0
  let clipSequence = 0
  let manualRequested = false
  let manualOrigin: 'send-now' | 'suggestion' = 'send-now'
  let delay = options.settleMs ?? QUESTION_SETTLE_MS
  let queue: Promise<unknown> = Promise.resolve()
  const session = Math.random().toString(36).slice(2)
  const cancelTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const publish = () => options.onDraft(draft ? { ...draft } : null)
  const commit = () => {
    cancelTimer()
    if (!draft || stopped || processing || busy) return
    const relation = active?.id === draft.id ? 'update' : 'new'
    active = {
      id: draft.id,
      text: draft.text,
      version: relation === 'update' ? active!.version + 1 : 1,
      relation,
      origin: manualRequested ? manualOrigin : 'automatic',
    }
    draft = null
    manualRequested = false
    publish()
    options.onTrace?.('commit', {
      at: Date.now(),
      turn: active.id,
      version: active.version,
      origin: active.origin,
      captureEnd: quietSince,
      afterCaptureMs: quietSince === null ? null : Date.now() - quietSince,
    })
    options.onCommit({ ...active })
  }
  const schedule = () => {
    cancelTimer()
    if (!draft || stopped || processing || busy) return
    if (manualRequested) return commit()
    if (draft.complete && !draft.manual && !draft.uncertain) {
      // Count the quiet interval while transcription/judgement are running.
      const elapsed = quietSince === null ? 0 : Date.now() - quietSince
      const waitMs = Math.max(0, delay - elapsed)
      options.onTrace?.('settling', {
        at: Date.now(),
        waitMs,
        captureEnd: quietSince,
      })
      timer = setTimeout(commit, waitMs)
    }
  }
  const apply = (decision: TurnDecision) => {
    const { action, text, complete, reason } = decision
    if (action === 'skip' || !text.trim()) return
    if (action === 'suggest') {
      // An uncertain continuation must not let an earlier partial question escape.
      if (draft) {
        draft.uncertain = true
        draft.complete = false
        draft.reason = reason
        publish()
      }
      options.onSuggest(text, reason)
      return
    }
    if (draft && action === 'new-question') {
      if (draft.complete && !draft.manual) {
        // Explicit topic change is a boundary, even before the settling timer.
        const previous = draft
        const relation = active?.id === previous.id ? 'update' : 'new'
        active = {
          id: previous.id,
          text: previous.text,
          version: relation === 'update' ? active!.version + 1 : 1,
          relation,
          origin: 'automatic',
        }
        options.onCommit({ ...active })
      } else options.onSuggest(draft.text, draft.reason)
      draft = null
    }
    if (!draft) {
      const continuation = action === 'followup' && active
      draft = {
        id: continuation ? active!.id : `${session}-${++sequence}`,
        text: continuation ? active!.text : '',
        complete: false,
        manual: false,
        reason,
      }
    }
    draft.text = append(draft.text, text)
    draft.complete = complete && action !== 'context'
    if (draft.complete) draft.uncertain = false
    draft.reason = reason
    if (draft.text.length > MAX_DRAFT_CHARS) {
      options.onSuggest(draft.text, draft.reason)
      draft = null
      manualRequested = false
    }
    publish()
  }
  return {
    accept(texts: string[], unfinishedTurn = false): Promise<void> {
      const clip = ++clipSequence
      options.onTrace?.('transcript-ready', {
        clip,
        at: Date.now(),
        captureEnd: quietSince,
      })
      const acceptedEpoch = epoch
      processing++
      cancelTimer()
      const run = queue
        .then(async () => {
          if (stopped || acceptedEpoch !== epoch) return
          const context = {
            pending: draft?.text ?? '',
            active: active?.text ?? '',
            recent: recent.slice(-6),
          }
          const decision = await options.judge(texts, context)
          if (stopped || acceptedEpoch !== epoch) return
          delay = unfinishedTurn
            ? UNFINISHED_TURN_SETTLE_MS
            : (options.settleMs ?? QUESTION_SETTLE_MS)
          options.onTrace?.('decision-ready', {
            clip,
            at: Date.now(),
            action: decision.action,
            complete: decision.complete,
          })
          apply(decision)
          recent = [...recent, texts[0] ?? ''].slice(-6)
        })
        .finally(() => {
          processing--
          schedule()
        })
      queue = run.catch(() => {})
      return run
    },
    audioActivity(isHearing: boolean) {
      if (isHearing !== hearing) {
        hearing = isHearing
        quietSince = hearing ? null : Date.now()
        if (!hearing) options.onTrace?.('capture-end', { at: quietSince })
      }
    },
    activity(isBusy: boolean) {
      busy = isBusy
      schedule()
    },
    sendNow() {
      const available = !!draft || processing > 0
      manualOrigin = 'send-now'
      manualRequested = available
      schedule()
      return available
    },
    keepListening() {
      if (draft) {
        draft.manual = true
        draft.reason = 'Waiting for you to send'
        cancelTimer()
        publish()
      }
    },
    discard() {
      epoch++
      manualRequested = false
      quietSince = null
      cancelTimer()
      draft = null
      publish()
    },
    confirm(text: string) {
      epoch++
      cancelTimer()
      // A manual click does not establish semantic relatedness or spoken order.
      // Preserve unsent context; never append a stale recommendation to an answer.
      if (draft && draft.text !== text)
        options.onSuggest(draft.text, 'Unsent question context')
      draft = null
      active = null
      manualOrigin = 'suggestion'
      manualRequested = true
      apply({
        action: 'new-question',
        complete: true,
        text,
        reason: 'Sent as a new question by you',
      })
      schedule()
    },
    endTurn() {
      active = null
    },
    stop() {
      stopped = true
      epoch++
      cancelTimer()
      draft = null
      publish()
    },
  }
}
