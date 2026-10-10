import { useEffect } from 'react'
import {
  IconCode,
  IconHeadphones,
  IconHeadphonesOff,
  IconX,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import {
  ClipLog,
  setSuggestionSender,
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
  wordCount,
  createRelevanceFilter,
  getJudgeModel,
  getSecondJudge,
  getWaitMode,
} from '@/lib/speakerFilter'
import { useModelProvider } from '@/hooks/useModelProvider'
import { anthropicConfig } from '@/lib/anthropicProvider'
import { useAssistant } from '@/hooks/useAssistant'
import { activeKeyTerms } from '@/lib/keyTerms'
import { DEFAULT_PAUSE_OPTIONS } from '@/lib/speakerCapture'
import {
  ANSWER_WORDS,
  createCallLevel,
  createTurnTracker,
  getMicTurns,
  startMicActivity,
} from '@/lib/micActivity'
import { CODING_OFFER_COOLDOWN_MS, isCodingCue } from '@/lib/codingCue'
import { TurnCheck, createTurnListener, getSmartTurn } from '@/lib/smartTurn'
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
  toast('Coding mode? Press fn + Left', {
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
  'off': 'Speaker off',
  'starting': 'Starting…',
  'needs-click': 'Click to start listening',
  'listening': 'Listening to speaker',
  'hearing': 'Hearing…',
  'transcribing': 'Transcribing…',
  'no-device': 'BlackHole not found',
  'blocked': 'Allow audio access',
  'unsupported': 'Not supported here',
  'error': 'Speaker error',
}

const ENGINE_NAMES: Record<string, string> = {
  'elevenlabs': 'ElevenLabs',
  'grok': 'Grok',
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
    const turnListener = createTurnListener()
    // Your own mic tells when the interviewer's question is over; sound it
    // picks up while the call is loud is the interviewer through the speakers
    const call = createCallLevel(DEFAULT_PAUSE_OPTIONS.threshold)
    const mic = startMicActivity(call.talking)
    const turns = createTurnTracker(mic, getMicTurns)
    const log = (clip: ClipLog) => {
      const line = `${clip.sent ? 'sent' : 'skipped'} "${clip.text}" | ${describeClip(clip)}${clip.note ? ` | ${clip.note}` : ''}`
      // Each engine's own words, so their accuracy can be compared
      const heard = clip.engines.length
        ? words.map((w) => ` | ${w.name}: "${w.text}"`).join('')
        : ''
      console.info(`[speaker] ${line}`)
      // Settings in effect, so the server log shows how each clip was handled
      const settings = [
        `judge=${getJudgeModel()}`,
        `second=${getSecondJudge() ?? 'off'}`,
        `wait=${getWaitMode() ? 'on' : 'off'}`,
        `live=${getLiveMode() ? 'on' : 'off'}`,
        `engines=${getTranscribeMode()}`,
        `terms=${speakerKeyTerms().length}`,
        `coding=${useSpeakerTranscription.getState().coding ? 'on' : 'off'}`,
        `mic=${!getMicTurns() ? 'off' : mic.on() ? 'on' : 'unavailable'}`,
        `smartturn=${getSmartTurn() ? turnListener.state() : 'off'}`,
        `turn=${turnCheck ? turnCheck.probability.toFixed(2) : 'na'}`,
        // Which candidate's assistant was in use; spaces kept out of the field
        `assistant=${(useAssistant.getState().currentAssistant?.name ?? 'none').replace(/\s+/g, '_')}`,
      ].join(' ')
      reportClip(`${line} | ${settings}${heard}`)
      useSpeakerTranscription.getState().logClip(clip)
      offerCodingMode(clip.text)
    }
    const filter = createRelevanceFilter(
      () => {
        const groq = useModelProvider.getState().getProviderByName('groq')
        const cerebras = useModelProvider
          .getState()
          .getProviderByName('cerebras')
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
      },
      (info) => (check = info),
      Date.now,
      {
        enabled: getWaitMode,
        smartTurn: getSmartTurn,
        // Keep holding while the speaker talks or the next clip transcribes.
        busy: () =>
          ['hearing', 'transcribing'].includes(
            useSpeakerTranscription.getState().status
          ),
        // The judges disagreed: offer it as a chip instead of sending it
        onUnsure: (text) => useSpeakerTranscription.getState().suggest(text),
        onLate: (clip) => {
          turnCheck = null
          log({ ...clip, engines: [], note: clip.check?.note })
          if (clip.sent) send(clip.text)
        },
      }
    )
    // A question that takes in the one just sent replaces it in the chat, and
    // so does anything more the interviewer asks before you start answering
    const send = (text: string) => {
      const speaker = useSpeakerTranscription.getState()
      if (filter.takeRevision(text)) {
        turns.revised(text)
        speaker.revise(text)
        return
      }
      const turn = turns.next(text)
      if (!turn.continues) return speaker.enqueue(turn.text)
      reportClip(
        `joined "${turn.text}" | You hadn't spoken since the last question`
      )
      speaker.revise(turn.text)
    }
    // A tapped suggestion goes out like any question and counts as sent
    const unregisterSuggestions = setSuggestionSender((text) => {
      filter.markSent(text)
      log({ text, sent: true, engines: [], note: 'Sent from a suggestion' })
      send(text)
    })
    // F16 from Hammerspoon sends everything heard since the last question
    const unregister = setScenarioSender(() => {
      const text = filter.takeScenario()
      if (text)
        log({
          text,
          sent: true,
          engines: [],
          note: 'Sent with the scenario key',
        })
      return text
    })
    const session = startSpeakerCapture({
      onStatus: setStatus,
      // Only real questions and requests are sent.
      accept: async (texts, engines, engineWords = [], turn = null) => {
        check = undefined
        words = engineWords
        turnCheck = turn
        try {
          const text = await filter(texts, turn)
          // A long clip that isn't a question (or the start of one) is most
          // likely your answer, which ends the interviewer's turn
          if (
            text === null &&
            !filter.holding() &&
            wordCount(texts[0]) >= ANSWER_WORDS
          )
            turns.end()
          log({
            text: text ?? texts[0],
            sent: text !== null,
            engines,
            check,
            note: check?.note,
          })
          return text
        } catch (err) {
          log({
            text: texts[0],
            sent: false,
            engines,
            note: (err as Error).message,
          })
          throw err
        }
      },
      // ChatInput sends queued questions as soon as no reply is streaming.
      onText: (text) => send(text),
      onLevel: call.push,
      onAudio: turnListener.push,
      checkTurn: turnListener.check,
    })
    // A question held while the interviewer sounded mid-turn goes out as soon
    // as you start answering: they have finished
    const flushOnSpeech = setInterval(() => {
      const since = filter.heldSince()
      if (getSmartTurn() && since !== null && mic.spokeAt() > since)
        void filter.flush()
    }, 250)
    return () => {
      clearInterval(flushOnSpeech)
      session.stop()
      filter.stop()
      mic.stop()
      unregister()
      unregisterSuggestions()
    }
  }, [enabled, setStatus])

  return null
}

/**
 * Clips the two judges disagreed on, each sent with a click. A row of its own
 * above the prompt, so a narrow window wraps them instead of squeezing the
 * model picker.
 */
export function SpeakerSuggestions() {
  const { enabled, suggestions, acceptSuggestion, dismissSuggestion } =
    useSpeakerTranscription()
  if (isPlatformTauri() || !enabled || suggestions.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 p-2 pb-0">
      {suggestions.map((text) => (
        <div
          key={text}
          data-test-id="speaker-suggestion"
          className="h-7 max-w-full flex items-center rounded-sm text-xs bg-accent/10 text-accent"
        >
          <button
            type="button"
            title={text}
            onClick={() => acceptSuggestion(text)}
            className="h-full min-w-0 px-2 truncate hover:bg-accent/15 rounded-l-sm"
          >
            {text}
          </button>
          <button
            type="button"
            aria-label="Dismiss suggestion"
            onClick={() => dismissSuggestion(text)}
            className="h-full px-1 shrink-0 hover:bg-accent/15 rounded-r-sm"
          >
            <IconX size={12} />
          </button>
        </div>
      ))}
    </div>
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
