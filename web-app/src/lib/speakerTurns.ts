import { type TurnContext, type TurnDecision } from './speakerTurnJudge'

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
  queuedQuestions?: number
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
  onTrace?: (event: string, fields: Record<string, unknown>) => void
}
type Fragment = { text: string; clip: number; captureEnd: number }
type HeldQuestion = { draft: QuestionDraft; fragments: Fragment[] }

/** Approval is the boundary: judges advise, but never send or delete speech. */
export function createQuestionTurns(options: Options) {
  let held: HeldQuestion[] = []
  let selected: string | undefined
  let active: QuestionCommit | null = null
  let recent: string[] = []
  let stopped = false
  let epoch = 0
  let sequence = 0
  let clipSequence = 0
  let quietSince: number | null = null
  let queue: Promise<unknown> = Promise.resolve()
  const session = Math.random().toString(36).slice(2)
  const owner = (fragment?: Fragment) =>
    fragment ? held.find((q) => q.fragments.includes(fragment)) : undefined
  const current = () => held.find((q) => q.draft.id === selected) ?? held[0]
  const publish = () => {
    const question = current()
    selected = question?.draft.id
    options.onDraft(
      question ? { ...question.draft, queuedQuestions: held.length - 1 } : null
    )
  }
  const refresh = (q: HeldQuestion) => {
    q.draft.text = q.fragments.map((f) => f.text).join(' ')
    const last = q.fragments.at(-1)!
    q.draft.clip = last.clip
    q.draft.captureEnd = last.captureEnd
  }
  const create = (fragment: Fragment) => {
    const q: HeldQuestion = {
      draft: {
        id: `${session}-${++sequence}`,
        text: fragment.text,
        complete: false,
        manual: false,
        requiresReview: true,
        relation: 'new',
        reason: 'Ready for your review',
      },
      fragments: [fragment],
    }
    refresh(q)
    held.push(q)
    return q
  }
  const remove = (q: HeldQuestion) => {
    held = held.filter((item) => item !== q)
    if (selected === q.draft.id) selected = undefined
  }
  const commit = (q: HeldQuestion, origin: 'send-now' | 'suggestion') => {
    active = {
      id: q.draft.id,
      text: q.draft.text,
      version: 1,
      relation: 'new',
      origin,
      captureEnd: q.draft.captureEnd,
      clip: q.draft.clip,
    }
    remove(q)
    publish()
    options.onTrace?.('commit', {
      at: Date.now(),
      turn: active.id,
      origin,
      clip: active.clip,
      captureEnd: active.captureEnd,
      afterCaptureMs:
        active.captureEnd == null ? null : Date.now() - active.captureEnd,
    })
    options.onCommit({ ...active })
  }
  return {
    accept(
      texts: string[],
      _unfinishedTurn = false,
      capture?: { clipId: number; captureEnd: number }
    ): Promise<void> {
      if (stopped) return Promise.resolve()
      const text = texts.find((t) => t.trim())?.trim()
      if (!text) return Promise.resolve()
      const fragment: Fragment = {
        text,
        clip: capture?.clipId ?? ++clipSequence,
        captureEnd: capture?.captureEnd ?? quietSince ?? Date.now(),
      }
      const transcriptReady = Date.now()
      const previous = held.at(-1)
      const previousFragment = previous?.fragments.at(-1)
      // Incomplete scenario fragments stay together. A completed question keeps
      // its own place while the next clip's topic is classified in the background.
      if (
        previous &&
        !previous.draft.complete &&
        previous.draft.text.length + text.length < MAX_DRAFT_CHARS
      ) {
        previous.fragments.push(fragment)
        refresh(previous)
      } else create(fragment)
      publish()
      options.onTrace?.('transcript-ready', {
        clip: fragment.clip,
        at: transcriptReady,
        captureEnd: fragment.captureEnd,
        captureEndKind: capture ? 'clip-finalized' : 'quiet-state-snapshot',
      })
      const acceptedEpoch = epoch
      const run = queue.then(async () => {
        const q = owner(fragment)
        if (stopped || epoch !== acceptedEpoch || !q) return
        const preceding = owner(previousFragment)
        const context = {
          pending:
            preceding?.fragments
              .filter(
                (f) =>
                  f.clip !== fragment.clip &&
                  (q !== preceding ||
                    preceding.fragments.indexOf(f) <
                      preceding.fragments.indexOf(fragment))
              )
              .map((f) => f.text)
              .join(' ') ?? '',
          active: active?.text ?? '',
          recent: recent.slice(-6),
        }
        const started = Date.now()
        options.onTrace?.('judge-start', {
          clip: fragment.clip,
          at: started,
          queuedMs: started - transcriptReady,
          pendingChars: context.pending.length,
          activeChars: context.active.length,
        })
        let decision: TurnDecision
        try {
          decision = await options.judge(texts, context)
        } catch {
          options.onTrace?.('judge-unavailable', {
            clip: fragment.clip,
            at: Date.now(),
          })
          return // Transcription remains reviewable even if the judge fails.
        }
        if (stopped || epoch !== acceptedEpoch) return
        const target = owner(fragment)
        if (!target) return // Sent or discarded speech cannot be resurrected.
        const before = owner(previousFragment)
        options.onTrace?.('decision-ready', {
          clip: fragment.clip,
          at: Date.now(),
          judgeMs: Date.now() - started,
          action: decision.action,
          complete: decision.complete,
          reason: decision.reason,
        })
        let result = target
        if (
          before &&
          before !== target &&
          (decision.action === 'context' || decision.action === 'question') &&
          before.draft.text.length + target.draft.text.length < MAX_DRAFT_CHARS
        ) {
          before.fragments.push(...target.fragments)
          remove(target)
          result = before
          refresh(result)
        } else if (
          before === target &&
          decision.action === 'new-question' &&
          previousFragment &&
          target.fragments.indexOf(fragment) > 0 &&
          target.draft.complete
        ) {
          // Keep both topics, including any fragments that arrived while judging.
          const splitAt = target.fragments.indexOf(fragment)
          const following = target.fragments.splice(splitAt)
          refresh(target)
          result = create(following[0])
          result.fragments = following
          refresh(result)
          held = held.filter((q) => q !== result)
          held.splice(held.indexOf(target) + 1, 0, result)
        }
        result.draft.complete ||= decision.complete
        result.draft.uncertain =
          decision.action === 'suggest' || decision.action === 'skip'
        result.draft.reason = decision.reason
        if (
          active &&
          !before &&
          (decision.action === 'followup' ||
            decision.action === 'question' ||
            decision.action === 'context')
        )
          result.draft.followsQuestion = active.id
        recent = [...recent, text].slice(-6)
        publish()
      })
      queue = run.catch(() => {})
      return run
    },
    audioActivity(hearing: boolean) {
      quietSince = hearing ? null : Date.now()
    },
    activity(busy: boolean) {
      options.onTrace?.('capture-busy', { at: Date.now(), busy })
    },
    sendNow() {
      const q = current()
      if (!q || stopped) return false
      commit(q, 'send-now')
      return true
    },
    next() {
      if (held.length < 2) return
      selected = held[(held.indexOf(current()!) + 1) % held.length].draft.id
      publish()
    },
    keepListening() {
      const q = current()
      if (q) {
        q.draft.manual = true
        publish()
      }
    },
    discard() {
      const q = current()
      if (q) {
        options.onTrace?.('review-discarded', {
          at: Date.now(),
          turn: q.draft.id,
        })
        remove(q)
        publish()
      }
    },
    reset() {
      epoch++
      held = []
      selected = undefined
      active = null
      recent = []
      quietSince = null
      queue = Promise.resolve()
      publish()
    },
    confirm(text: string) {
      const existing = held.find((q) => q.draft.text === text)
      const q =
        existing ??
        create({ text, clip: ++clipSequence, captureEnd: Date.now() })
      if (!stopped) commit(q, 'suggestion')
    },
    endTurn() {
      active = null
    },
    stop() {
      stopped = true
      epoch++
      held = []
      selected = undefined
      publish()
    },
  }
}
