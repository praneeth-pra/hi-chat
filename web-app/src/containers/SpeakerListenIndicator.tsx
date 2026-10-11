import { useEffect, useState } from 'react'
import {
  IconCode,
  IconHeadphones,
  IconHeadphonesOff,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import {
  ClipLog,
  setSuggestionSender,
  setQuestionControls,
  SpeakerStatus,
  useSpeakerTranscription,
} from '@/hooks/useSpeakerTranscription'
import {
  getTranscribeMode,
  reportClip,
  setKeyTermsSource,
  startSpeakerCapture,
} from '@/lib/speakerCaptureSession'
import { getLiveMode } from '@/lib/speakerLive'
import {
  CheckInfo,
  getJudgeModel,
  getSecondJudge,
  getWaitMode,
} from '@/lib/speakerFilter'
import { useModelProvider } from '@/hooks/useModelProvider'
import { anthropicConfig } from '@/lib/anthropicProvider'
import { useAssistant } from '@/hooks/useAssistant'
import { activeKeyTerms } from '@/lib/keyTerms'
import { CODING_OFFER_COOLDOWN_MS, isCodingCue } from '@/lib/codingCue'
import {
  TurnCheck,
  createTurnListener,
  getSmartTurn,
  SMART_TURN_HOLD_BELOW,
} from '@/lib/smartTurn'
import { createQuestionTurns, SPEAKER_REVIEW_MS } from '@/lib/speakerTurns'
import { judgeSpeakerTurn } from '@/lib/speakerTurnJudge'
import { useThreads } from '@/hooks/useThreads'
import { toast } from 'sonner'
import { isPlatformTauri } from '@/lib/platform/utils'
import {
  listenForSpeakerKeys,
  setScenarioSender,
} from '@/lib/speakerRemoteKeys'

let codingOfferedAt = 0

/** Offers coding mode when the interviewer starts the hands-on part. */
function offerCodingMode(text: string) {
  const state = useSpeakerTranscription.getState()
  if (state.coding || !isCodingCue(text)) return
  if (Date.now() - codingOfferedAt < CODING_OFFER_COOLDOWN_MS) return
  codingOfferedAt = Date.now()
  toast('Ready for coding mode?', {
    duration: 8000,
    action: {
      label: 'Turn on',
      onClick: () => useSpeakerTranscription.getState().setCoding(true),
    },
  })
}

/** The current assistant's key terms (or the start of your dictionary). */
const speakerKeyTerms = () =>
  activeKeyTerms(useAssistant.getState().currentAssistant?.keyterms)
setKeyTermsSource(speakerKeyTerms)

const LABELS: Record<SpeakerStatus, string> = {
  off: 'Speaker off',
  starting: 'Starting…',
  'needs-click': 'Click to start listening',
  listening: 'Listening to speaker',
  hearing: 'Hearing…',
  transcribing: 'Transcribing…',
  'no-device': 'BlackHole not found',
  blocked: 'Allow audio access',
  unsupported: 'Not supported here',
  error: 'Speaker error',
}

const ENGINE_NAMES: Record<string, string> = {
  elevenlabs: 'ElevenLabs',
  grok: 'Grok',
  'elevenlabs live': 'ElevenLabs live',
  'grok live': 'Grok live',
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** One line of timings, e.g. "ElevenLabs 0.6 s · Grok 0.7 s · Groq gpt-oss-120b 0.3 s". */
export function describeClip(clip: ClipLog) {
  const parts = clip.engines.map(
    (e) =>
      `${ENGINE_NAMES[e.name] ?? e.name} ${e.ok ? seconds(e.ms) : 'failed'}`
  )
  // A repeat is caught before Groq; the note says so.
  if (clip.check && clip.check.model !== 'repeat check' && clip.check.ms > 0)
    parts.push(`Groq ${clip.check.model} ${seconds(clip.check.ms)}`)
  return parts.join(' · ')
}

/** Runs speaker transcription for the whole web app (mounted once in the root). */
export function SpeakerTranscriptionProvider() {
  const enabled = useSpeakerTranscription((s) => s.enabled)
  const setStatus = useSpeakerTranscription((s) => s.setStatus)

  // F18 / F19 from a helper app (Hammerspoon) toggle coding mode / listening
  useEffect(() => (isPlatformTauri() ? undefined : listenForSpeakerKeys()), [])

  useEffect(() => {
    if (isPlatformTauri() || !enabled) {
      setStatus('off')
      return
    }
    let check: CheckInfo | undefined
    let words: { name: string; text: string }[] = []
    let turnCheck: TurnCheck | null = null
    // Hears from the interviewer's voice whether they have finished
    const newTurnListener = () =>
      createTurnListener(undefined, undefined, {
        onState: (state, reason) =>
          reportClip(
            `stage=smartturn state=${state}${reason ? ` reason=${reason}` : ''}`
          ),
      })
    let turnListener = getSmartTurn() ? newTurnListener() : null
    const log = (clip: ClipLog) => {
      const line = `${clip.sent ? 'sent' : clip.check?.type === 'skip' ? 'skipped' : 'buffered'} "${clip.text}" | ${describeClip(clip)}${clip.note ? ` | ${clip.note}` : ''}`
      // Each engine's own words, so their accuracy can be compared
      const heard = clip.engines.length
        ? words.map((w) => ` | ${w.name}: "${w.text}"`).join('')
        : ''
      console.info(`[speaker] ${line}`)
      // Settings in effect, so the server log shows how each clip was handled
      const settings = [
        `judge=${getJudgeModel()}`,
        `second=${getSecondJudge() ?? 'off'}`,
        'protocol=intent-v2',
        `endpoint_ms=${getWaitMode() ? 600 : 900}`,
        'turns=on',
        `live=${getLiveMode() ? 'on' : 'off'}`,
        `engines=${getTranscribeMode()}`,
        `terms=${speakerKeyTerms().length}`,
        `coding=${useSpeakerTranscription.getState().coding ? 'on' : 'off'}`,
        `smartturn=${getSmartTurn() ? (turnListener?.state() ?? 'off') : 'off'}`,
        `turn=${turnCheck ? turnCheck.probability.toFixed(2) : 'na'}`,
        // Which candidate's assistant was in use; spaces kept out of the field
        `assistant=${(useAssistant.getState().currentAssistant?.name ?? 'none').replace(/\s+/g, '_')}`,
      ].join(' ')
      reportClip(`${line} | ${settings}${heard}`)
      useSpeakerTranscription.getState().logClip(clip)
      offerCodingMode(clip.text)
    }
    const getConfig = () => {
      const groq = useModelProvider.getState().getProviderByName('groq')
      const cerebras = useModelProvider.getState().getProviderByName('cerebras')
      return {
        apiKey: groq?.api_key,
        baseUrl: groq?.base_url,
        cerebras: { apiKey: cerebras?.api_key, baseUrl: cerebras?.base_url },
        anthropic: anthropicConfig(useModelProvider.getState().providers),
        judge: getJudgeModel(),
        secondJudge: getSecondJudge(),
        keyterms: speakerKeyTerms(),
        coding: useSpeakerTranscription.getState().coding,
      }
    }
    const turns = createQuestionTurns({
      onTrace: (event, fields) =>
        reportClip(`stage=${event} ${JSON.stringify(fields)}`),
      judge: (texts, context) =>
        judgeSpeakerTurn(texts, context, getConfig(), (info) => {
          check = info
        }),
      onDraft: (draft) =>
        useSpeakerTranscription.getState().setPendingQuestion(draft),
      onSuggest: (text, reason) =>
        useSpeakerTranscription.getState().suggest(text, reason),
      onCommit: (turn) => {
        useSpeakerTranscription
          .getState()
          .queueTurn(turn, useThreads.getState().currentThreadId)
        reportClip(
          `sent "${turn.text}" | turn=${turn.id} version=${turn.version} relation=${turn.relation} origin=${turn.origin ?? 'unknown'} queuedAt=${Date.now()}`
        )
      },
    })
    const unregisterControls = setQuestionControls({
      sendNow: turns.sendNow,
      expireReview: turns.expireReview,
      keepListening: turns.keepListening,
      discard: () => {
        turns.discard()
        session.restart()
      },
    })
    let deliveryEpoch = useSpeakerTranscription.getState().deliveryEpoch
    const unregisterEpoch = useSpeakerTranscription.subscribe((state) => {
      if (state.deliveryEpoch !== deliveryEpoch) {
        deliveryEpoch = state.deliveryEpoch
        turns.discard()
        turns.endTurn()
        session.restart()
      }
    })
    const unregisterSuggestions = setSuggestionSender((text) =>
      turns.confirm(text)
    )
    // F16 commits the assembled question through the same coordinator as the UI.
    const unregister = setScenarioSender(() => turns.sendNow())
    let threadId = useThreads.getState().currentThreadId
    const unregisterThread = useThreads.subscribe((state) => {
      if (state.currentThreadId === threadId) return
      const createdBySpeaker =
        !threadId &&
        !!state.currentThreadId &&
        useSpeakerTranscription.getState().sendingTurn?.threadId ===
          state.currentThreadId
      threadId = state.currentThreadId
      if (!createdBySpeaker) {
        turns.discard()
        turns.endTurn()
        useSpeakerTranscription.getState().resetTurns()
      }
    })
    const session = startSpeakerCapture({
      onStatus: (status) => {
        setStatus(status)
        turns.audioActivity(status === 'hearing')
        turns.activity(status === 'hearing' || status === 'transcribing')
      },
      accept: async (
        texts,
        engines,
        engineWords = [],
        turn = null,
        capture
      ) => {
        check = undefined
        words = engineWords
        turnCheck = turn
        await turns.accept(
          texts,
          !!(
            getSmartTurn() &&
            turn &&
            turn.probability < SMART_TURN_HOLD_BELOW
          ),
          capture
        )
        const info = check as CheckInfo | undefined
        log({
          text: texts[0],
          sent: false,
          engines,
          check: info,
          note: info?.note ?? 'Added to question turn',
        })
        // Only the coordinator may send, never an individual capture clip.
        return null
      },
      onText: () => {},
      onAudio: (samples) => {
        if (getSmartTurn()) {
          turnListener ??= newTurnListener()
          turnListener.push(samples)
        }
      },
      checkTurn: () =>
        getSmartTurn()
          ? (turnListener?.check() ?? Promise.resolve(null))
          : Promise.resolve(null),
    })
    return () => {
      session.stop()
      turns.stop()
      turnListener?.dispose()
      unregisterControls()
      unregisterEpoch()
      unregisterThread()
      useSpeakerTranscription.getState().resetTurns()
      unregister()
      unregisterSuggestions()
    }
  }, [enabled, setStatus])

  return null
}

/** The draft is distinct from sent chat messages and survives long scenario pauses. */
export function SpeakerPendingQuestion() {
  const {
    enabled,
    pendingQuestion,
    sendingTurn,
    sendPendingQuestion,
    discardPendingQuestion,
  } = useSpeakerTranscription()
  const [expired, setExpired] = useState('')
  const reviewKey = pendingQuestion
    ? `${pendingQuestion.id}:${pendingQuestion.text}:${pendingQuestion.reviewUntil ?? 0}`
    : ''
  useEffect(() => {
    if (!enabled || !pendingQuestion || pendingQuestion.complete) return
    const snapshot = pendingQuestion
    const timer = setTimeout(
      () => {
        setExpired(reviewKey)
        const current = useSpeakerTranscription.getState()
        // Expired additions are never attached to an already answered question.
        if (
          snapshot.relation === 'update' &&
          current.pendingQuestion?.id === snapshot.id &&
          current.pendingQuestion.text === snapshot.text
        )
          current.expirePendingReview(snapshot.id, snapshot.text)
      },
      Math.max(
        0,
        (snapshot.reviewUntil ?? Date.now() + SPEAKER_REVIEW_MS) - Date.now()
      )
    )
    return () => clearTimeout(timer)
  }, [
    enabled,
    pendingQuestion?.id,
    pendingQuestion?.text,
    pendingQuestion?.complete,
    pendingQuestion?.relation,
    pendingQuestion?.reviewUntil,
  ])
  if (isPlatformTauri() || !enabled) return null
  if (!pendingQuestion)
    return sendingTurn ? (
      <div className="px-3 pt-2 text-sm text-main-view-fg/60" role="status">
        {sendingTurn.relation === 'update'
          ? 'Updating the same question…'
          : 'Preparing answer…'}
      </div>
    ) : null
  if (expired === reviewKey && !pendingQuestion.complete) return null
  return (
    <div
      className="m-2 rounded-md border border-main-view-fg/15 p-3 text-sm"
      data-test-id="speaker-pending-question"
    >
      <div className="font-medium">
        {pendingQuestion.manual
          ? 'Waiting for you to send'
          : pendingQuestion.uncertain
            ? 'Waiting for clearer speech…'
            : pendingQuestion.complete
              ? pendingQuestion.relation === 'new'
                ? 'Sending new question…'
                : 'Sending automatically…'
              : pendingQuestion.relation === 'update'
                ? 'Add to this question?'
                : 'Building question…'}
      </div>
      {!pendingQuestion.complete && (
        <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap">
          {pendingQuestion.addition ?? pendingQuestion.text}
        </p>
      )}
      {!pendingQuestion.complete && (
        <p className="mt-1 text-xs text-main-view-fg/50">
          {pendingQuestion.relation === 'update'
            ? 'Addition to the current question'
            : 'New question setup'}{' '}
          · hides after 3 seconds
        </p>
      )}
      {pendingQuestion.uncertain && (
        <p className="mt-1 text-main-view-fg/60">{pendingQuestion.reason}</p>
      )}
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          className="text-accent"
          onClick={sendPendingQuestion}
        >
          {pendingQuestion.relation === 'update' ? 'Add' : 'Send now'}{' '}
          <kbd className="ml-1 text-xs">fn + →</kbd>
        </button>
        <button type="button" onClick={discardPendingQuestion}>
          Discard <kbd className="ml-1 text-xs">fn + ←</kbd>
        </button>
      </div>
    </div>
  )
}

/** Manual fallback cards are separate from automatically delivered questions. */
export function SpeakerSuggestions() {
  const {
    enabled,
    pendingQuestion,
    suggestions,
    suggestionReasons,
    acceptSuggestion,
    dismissSuggestion,
  } = useSpeakerTranscription()
  const newestText = suggestions[0]
  useEffect(() => {
    if (!enabled || !newestText) return
    const timer = setTimeout(
      () => useSpeakerTranscription.getState().dismissSuggestion(newestText),
      SPEAKER_REVIEW_MS
    )
    return () => clearTimeout(timer)
  }, [enabled, newestText])
  if (isPlatformTauri() || !enabled || pendingQuestion || !suggestions.length)
    return null
  const card = (text: string, newest = false) => (
    <article
      key={text}
      aria-label={
        newest
          ? 'Latest speaker recommendation'
          : 'Earlier speaker recommendation'
      }
      data-test-id="speaker-suggestion"
      className="rounded-lg border border-main-view-fg/15 bg-main-view-fg/5 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-main-view-fg/70">
          {newest ? 'New question?' : 'Earlier recommendation'}
        </span>
        <span className="rounded bg-accent/10 px-2 py-0.5 text-xs text-accent">
          Needs review
        </span>
      </div>
      <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">
        {text}
      </p>
      <p className="mt-2 break-words text-xs text-main-view-fg/60">
        {suggestionReasons[text] ?? 'Speech needs clarification'}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => acceptSuggestion(text)}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Send as new
          {newest && <kbd className="ml-2 text-xs opacity-75">fn + →</kbd>}
        </button>
        <button
          type="button"
          aria-label="Discard recommendation"
          onClick={() => dismissSuggestion(text)}
          className="rounded-md border border-main-view-fg/15 px-3 py-2 text-sm hover:bg-main-view-fg/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Discard
          {newest && (
            <kbd className="ml-2 text-xs text-main-view-fg/60">fn + ←</kbd>
          )}
        </button>
        <span className="text-xs text-main-view-fg/50">
          New question · hides after 3 seconds
        </span>
      </div>
    </article>
  )
  return (
    <section aria-label="Speaker recommendations" className="space-y-2 p-2">
      <div className="flex flex-wrap items-center justify-between gap-1 px-1">
        <span className="text-xs font-medium text-main-view-fg/70">
          Speaker recommendations
        </span>
        <span className="text-xs text-main-view-fg/50">
          Clear questions send automatically
        </span>
      </div>
      {card(suggestions[0], true)}
    </section>
  )
}

/** Small on/off chip in the chat box showing what the speaker listener is doing. */
export function SpeakerListenIndicator() {
  const { enabled, status, error, setEnabled, coding, setCoding } =
    useSpeakerTranscription()
  // The chip only says "Speaker error" (and nothing on a phone): say why
  useEffect(() => {
    if (status === 'error' && error && !isPlatformTauri())
      toast.error(`Speaker error: ${error}`, { id: 'speaker-error' })
  }, [status, error])
  if (isPlatformTauri()) return null

  const active = ['listening', 'hearing', 'transcribing'].includes(status)
  const problem = ['no-device', 'blocked', 'unsupported', 'error'].includes(
    status
  )
  const label = !enabled
    ? LABELS.off
    : status === 'error' && error
      ? `${LABELS.error}: ${error}`
      : LABELS[status]
  return (
    <>
      {enabled && (
        <button
          type="button"
          data-test-id="speaker-coding-toggle"
          aria-pressed={coding}
          aria-label="Coding mode"
          title="Coding mode"
          onClick={() => setCoding(!coding)}
          className={cn(
            'h-7 px-2 flex items-center gap-1 rounded-sm text-xs whitespace-nowrap hover:bg-main-view-fg/10 transition-colors',
            coding ? 'text-accent bg-accent/10' : 'text-main-view-fg/50'
          )}
        >
          <IconCode size={16} />
          {coding && <span className="hidden sm:inline">Coding</span>}
        </button>
      )}
      <button
        type="button"
        data-test-id="speaker-listen-toggle"
        aria-pressed={enabled}
        aria-label={label}
        title={label}
        onClick={() => setEnabled(!enabled)}
        className={cn(
          'h-7 px-2 flex items-center gap-1 rounded-sm text-xs whitespace-nowrap hover:bg-main-view-fg/10 transition-colors',
          active && 'text-accent',
          problem && 'text-destructive',
          !active && !problem && 'text-main-view-fg/50'
        )}
      >
        {enabled ? (
          <IconHeadphones
            size={16}
            className={cn(status === 'hearing' && 'animate-pulse')}
          />
        ) : (
          <IconHeadphonesOff size={16} />
        )}
        <span className="hidden sm:inline">
          {enabled ? LABELS[status] : LABELS.off}
        </span>
      </button>
    </>
  )
}
