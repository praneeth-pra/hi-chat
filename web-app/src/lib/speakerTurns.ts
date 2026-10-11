import type { TurnContext, TurnDecision } from './speakerTurnJudge'

export const QUESTION_SETTLE_MS = 500
export const UNFINISHED_TURN_SETTLE_MS = 5000
const MAX_DRAFT_CHARS = 24000

export type QuestionDraft = {
  id: string
  text: string
  complete: boolean
  manual: boolean
  reason: string
}
export type QuestionCommit = {
  id: string
  version: number
  text: string
  relation: 'new' | 'update'
}
type Options = {
  judge: (texts: string[], context: TurnContext) => Promise<TurnDecision>
  onDraft: (draft: QuestionDraft | null) => void
  onCommit: (turn: QuestionCommit) => void
  onSuggest: (text: string) => void
  settleMs?: number
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
  let busy = false
  let stopped = false
  let epoch = 0
  let sequence = 0
  let manualRequested = false
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
    }
    draft = null
    manualRequested = false
    publish()
    options.onCommit({ ...active })
  }
  const schedule = () => {
    cancelTimer()
    if (!draft || stopped || processing || busy) return
    if (manualRequested) return commit()
    if (draft.complete && !draft.manual) timer = setTimeout(commit, delay)
  }
  const apply = (decision: TurnDecision) => {
    const { action, text, complete, reason } = decision
    if (action === 'skip' || !text.trim()) return
    if (action === 'suggest') {
      // An uncertain continuation must not let an earlier partial question escape.
      if (draft) {
        draft.manual = true
        draft.reason = reason
        publish()
      }
      options.onSuggest(text)
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
        }
        options.onCommit({ ...active })
      } else options.onSuggest(draft.text)
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
    draft.reason = reason
    if (draft.text.length > MAX_DRAFT_CHARS) {
      options.onSuggest(draft.text)
      draft = null
      manualRequested = false
    }
    publish()
  }
  return {
    accept(texts: string[], unfinishedTurn = false): Promise<void> {
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
    activity(isBusy: boolean) {
      busy = isBusy
      schedule()
    },
    sendNow() {
      const available = !!draft || processing > 0
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
      cancelTimer()
      draft = null
      publish()
    },
    confirm(text: string) {
      epoch++
      cancelTimer()
      manualRequested = true
      apply({
        action: draft || active ? 'followup' : 'question',
        complete: true,
        text,
        reason: 'Confirmed by you',
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
