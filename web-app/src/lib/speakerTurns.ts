import {
  hasQuestionCue,
  type TurnContext,
  type TurnDecision,
} from './speakerTurnJudge'

export const QUESTION_SETTLE_MS = 500
export const UNFINISHED_TURN_SETTLE_MS = 1000
export const SPEAKER_REVIEW_MS = 3000
const MAX_DRAFT_CHARS = 24000

export type QuestionDraft = {
  id: string
  text: string
  complete: boolean
  manual: boolean
  requiresReview?: boolean
  followsQuestion?: string
  uncertain?: boolean
  relation?: 'new' | 'update'
  addition?: string
  reviewUntil?: number
  captureEnd?: number | null
  clip?: number
  reason: string
}
export type QuestionCommit = {
  id: string
  version: number
  text: string
  relation: 'new' | 'update'
  origin?: 'automatic' | 'send-now' | 'suggestion'
  captureEnd?: number | null
  clip?: number
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
  let hasSentQuestion = false
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
  const emitDraft = () => {
    cancelTimer()
    if (!draft || stopped) return
    const relation = 'new' as const
    active = {
      id: draft.id,
      text: draft.text,
      version: 1,
      relation,
      origin: manualRequested ? manualOrigin : 'automatic',
      captureEnd: draft.captureEnd,
      clip: draft.clip,
    }
    draft = null
    hasSentQuestion = true
    manualRequested = false
    publish()
    options.onTrace?.('commit', {
      at: Date.now(),
      turn: active.id,
      version: active.version,
      origin: active.origin,
      clip: active.clip,
      captureEnd: active.captureEnd,
      afterCaptureMs:
        active.captureEnd == null ? null : Date.now() - active.captureEnd,
    })
    options.onCommit({ ...active })
  }
  const commit = () => {
    if (!draft || stopped) return
    emitDraft()
  }
  const schedule = () => {
    if (!draft || stopped) return
    if (manualRequested) {
      cancelTimer()
      commit()
      return
    }
    if (
      draft.complete &&
      !draft.manual &&
      !draft.requiresReview &&
      !draft.uncertain &&
      !timer
    ) {
      // The endpoint belongs to this contribution. Later speech and queued clips
      // cannot postpone a question already judged answerable.
      const elapsed = Date.now() - (draft.captureEnd ?? Date.now())
      const waitMs = Math.max(0, delay - elapsed)
      options.onTrace?.('settling', {
        at: Date.now(),
        waitMs,
        clip: draft.clip,
        captureEnd: draft.captureEnd,
        processing,
        busy,
      })
      timer = setTimeout(commit, waitMs)
    }
  }
  const suggestQuestion = (text: string, reason?: string) => {
    if (hasQuestionCue(text)) {
      options.onTrace?.('recommendation', { at: Date.now(), reason, text })
      options.onSuggest(text, reason)
    } else
      options.onTrace?.('recommendation-suppressed', {
        at: Date.now(),
        reason: 'No question evidence',
      })
  }
  const apply = (decision: TurnDecision) => {
    const { text, complete, reason } = decision
    let action = decision.action
    if (action === 'skip' || !text.trim()) return
    cancelTimer()
    if (action === 'suggest') {
      if (draft?.complete && !draft.manual && !draft.requiresReview) emitDraft()
      // An uncertain continuation must not let an earlier partial question escape.
      if (draft) {
        draft.uncertain = true
        draft.complete = false
        draft.reason = reason
        publish()
      }
      suggestQuestion(text, reason)
      return
    }
    // A later complete question replaces the previous unaccepted card.
    // Only unfinished fragments accumulate into one unsent scenario draft.
    if (draft?.requiresReview && draft.complete && complete) {
      options.onTrace?.('review-superseded', { at: Date.now(), turn: draft.id })
      draft = null
    }
    // A clip boundary cannot erase an answerable question or split unfinished setup.
    if (
      draft &&
      !draft.complete &&
      !draft.followsQuestion &&
      action === 'new-question' &&
      !complete
    )
      action = 'context'
    if (draft && draft.complete && !draft.manual && !draft.requiresReview) {
      emitDraft()
      if (action === 'context' || action === 'question') action = 'followup'
    }
    if (draft && action === 'new-question') {
      if (draft.complete && !draft.manual && !draft.requiresReview) {
        emitDraft()
      } else if (draft.requiresReview) {
        options.onTrace?.('context-cleared', {
          at: Date.now(),
          turn: draft.id,
          reason: 'new-topic',
          clip: draft.clip,
        })
      } else suggestQuestion(draft.text, draft.reason)
      draft = null
    }
    if (!draft) {
      const continuation = action === 'followup' && active
      draft = {
        id: `${session}-${++sequence}`,
        text: '',
        requiresReview: hasSentQuestion,
        followsQuestion: continuation ? active!.id : undefined,
        complete: false,
        manual: false,
        reason,
      }
    }
    draft.text = append(draft.text, text)
    draft.relation = 'new'
    draft.reviewUntil = Date.now() + SPEAKER_REVIEW_MS
    draft.complete = complete && action !== 'context'
    if (draft.complete) draft.uncertain = false
    draft.reason = reason
    if (draft.text.length > MAX_DRAFT_CHARS) {
      suggestQuestion(draft.text, draft.reason)
      draft = null
      manualRequested = false
    }
    publish()
  }
  return {
    accept(
      texts: string[],
      unfinishedTurn = false,
      capture?: { clipId: number; captureEnd: number }
    ): Promise<void> {
      const clip = capture?.clipId ?? ++clipSequence
      const captureEnd = capture?.captureEnd ?? quietSince ?? Date.now()
      const transcriptReady = Date.now()
      options.onTrace?.('transcript-ready', {
        clip,
        at: transcriptReady,
        captureEnd,
        captureEndKind: capture ? 'clip-finalized' : 'quiet-state-snapshot',
      })
      const acceptedEpoch = epoch
      processing++
      const run = queue
        .then(async () => {
          if (stopped || acceptedEpoch !== epoch) return
          const pendingId = draft?.id
          const context = {
            pending: draft?.text ?? '',
            active: active?.text ?? '',
            recent: recent.slice(-6),
          }
          const judgeStarted = Date.now()
          options.onTrace?.('judge-start', {
            clip,
            at: judgeStarted,
            queuedMs: judgeStarted - transcriptReady,
            pendingChars: context.pending.length,
            activeChars: context.active.length,
          })
          const decision = await options.judge(texts, context)
          if (stopped || acceptedEpoch !== epoch) return
          delay = unfinishedTurn
            ? UNFINISHED_TURN_SETTLE_MS
            : (options.settleMs ?? QUESTION_SETTLE_MS)
          options.onTrace?.('decision-ready', {
            clip,
            at: Date.now(),
            judgeMs: Date.now() - judgeStarted,
            action: decision.action,
            complete: decision.complete,
            reason: decision.reason,
            hadPending: !!context.pending,
            hadActive: !!context.active,
          })
          // A ready draft may have committed while this judge was running.
          // Recognize the continuation as a follow-up, offered as a separate prompt.
          if (
            !draft &&
            pendingId &&
            active?.id === pendingId &&
            (decision.action === 'question' || decision.action === 'context')
          )
            decision.action = 'followup'
          apply(decision)
          if (draft && decision.action !== 'skip') {
            draft.captureEnd = captureEnd
            draft.clip = clip
            publish()
          }
          if (decision.action !== 'skip' && decision.action !== 'suggest')
            recent = [...recent, decision.text].slice(-6)
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
      if (busy !== isBusy)
        options.onTrace?.('capture-busy', {
          at: Date.now(),
          busy: isBusy,
          processing,
          turn: draft?.id,
          clip: draft?.clip,
        })
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
    expireReview(id: string, text: string) {
      if (
        !draft ||
        draft.id !== id ||
        draft.text !== text ||
        (draft.complete && !draft.requiresReview)
      )
        return
      options.onTrace?.('review-hidden', {
        at: Date.now(),
        turn: draft.id,
        clip: draft.clip,
        relation: draft.relation,
      })
      // Visibility expires; the held follow-up remains available to later speech.
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
        suggestQuestion(draft.text, 'Unsent question context')
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
      hasSentQuestion = false
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
