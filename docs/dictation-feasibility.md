# Dictation feasibility: latency and accuracy

This is a code review of the current implementation, not a measurement of live
microphone performance. No dictation behavior was changed in this review.

## Current wiring

1. The mic button or remote key starts `lib/dictation.ts`. A warm microphone and
   roughly 130 ms of preroll reduce startup delay and missed initial words.
2. An AudioWorklet transfers 2048-sample blocks (about 43 ms at 48 kHz). Each block
   is downsampled to 16 kHz, saved for retry, and streamed while recording.
3. Auto runs Cartesia, Soniox and ElevenLabs concurrently. When recording stops,
   all streams finalize. Two transcripts with at least 0.93 word agreement can
   finish immediately. Otherwise the first nonempty result starts a one-second
   grace period for other engines. A single selected engine skips consensus.
4. Auto applies dictionary fixes, chooses the transcript with the best overall
   agreement, and invokes a judge only when the available engines disagree.
   The judge has a 1.5-second timeout; absent keys or failures retain the vote.
5. Empty or failed live results trigger batch upload to `/api/transcribe`. The
   relay races available ElevenLabs/Grok engines (`need=1`). Failed batch audio
   is retained for an explicit retry.
6. `dictationDelivery.ts` adds text to the real prompt and a dedicated delivery
   queue. `ChatInput.tsx` sends when an answer is not streaming, attachments are
   ready, and a model is selected. This path works with Speaker disabled.

External dictation via F20 and paste uses a different path: it currently enters
Speaker's legacy queue, bypasses the prompt preview, and depends on Speaker
being enabled. It should eventually share the dedicated dictation delivery path.

## Findings and recommended priorities

| Priority | Finding | Feasible improvement | Expected effect / tradeoff |
| --- | --- | --- | --- |
| 1 | Live finalization can wait eight seconds before batch fallback begins. Relay engine timeout is 200 seconds and the browser batch request has no separate abort deadline. | Start a hedged batch request after a measured live-finalization deadline, perhaps 0.8–1.5 seconds initially; cancel the losing route and add a bounded batch deadline with retained audio. | Reduces slow-tail latency, with extra uploads/cost on slow clips. Do not shorten finalization blindly: late final words can be lost. Tune from live p95 data. |
| 1 | Overall word agreement ignores punctuation/case and can exceed 0.93 despite an important technical word being wrong. The code's own example scores “S3 bucket” versus “Extra bucket” at 0.95 in a longer sentence. | Detect disagreement over numbers, negation, identifiers and supplied technical terms before bypassing the judge. Judge only those ambiguous spans; retain the rest verbatim. | Better semantic accuracy without putting an LLM on every dictation. A minority of clips pay extra latency. |
| 1 | The judge is prompted to use only heard words, but runtime validation merely requires 0.6 overlap with the chosen vote. Its 2000-token output limit can truncate long dictation. | Validate edits against the union of transcript words and permitted dictionary corrections; reject unexplained omissions/insertions. Use bounded span corrections or chunk long transcripts. | Prevents invented details and dropped text. Keep the original transcript whenever validation fails. |
| 1 | Delivery entries are plain strings, without the originating chat, delivery ID or edit version. Waiting text can be edited or the chat changed before it sends. A send failure restores the old text unconditionally. | Bind recording/delivery to its chat and draft version; cancel or request review on edits/chat switches. Restore failed text without overwriting newer typing. Unify external dictation with this route. | Improves reliability and protects user intent; adds no required model latency. Preserve the user's chosen automatic-send behavior for unchanged input. |
| 2 | The worklet posts only full blocks. Stop releases the recording without flushing the partially filled block; queued worklet messages can also arrive after stop. | Add a worklet stop/flush acknowledgement so the recording owns all samples through its endpoint. | Protects final phonemes. Typically costs at most one worklet/message round trip; verify on Safari and Bluetooth inputs. |
| 2 | Dictionary substitutions are global: examples such as “local answer” → “load balancer” can alter correctly heard nontechnical speech. Agreement is tested before these substitutions, while voting/judging occurs after them. | Split safe formatting fixes from ambiguous contextual substitutions. Apply conservative fixes consistently before comparison; require context/evidence for ambiguous substitutions. | Prevents deterministic wrong corrections and avoids unnecessary waits when safe corrections align engines. |
| 2 | Startup warms the microphone but starts token/WebSocket setup at recording start. Preroll protects words, but short dictations can spend time waiting for connection setup after stop. | Measure connection readiness separately; optionally preconnect the preferred engine on an intentional user gesture using valid, short-lived tokens. | Reduces short-clip latency. Balance extra connection cost and token expiry; warming the mic alone is already useful. |
| 3 | Each 2048-sample block is independently averaged and rounded during resampling. This discards a small remainder per block and uses a basic filter. | Use continuous resampling with carried sample/phase state, after testing recorded audio at 44.1/48 kHz. | Small drift/filter-quality improvement; lower priority than finalization and critical-word mistakes. |

Keep the judge as an exception path rather than the default. Three-engine Auto
already has a useful fast path, but adding engines or choosing a new default
without representative recordings is unlikely to give a dependable gain.

## Validation and rollout

Add timestamps for start key, mic ready, socket ready, recording stop, each engine
final, consensus/grace expiry, judge start/end, batch start/end, text in prompt,
queue wait, and actual send. Current Auto logs cover engine completion and judge
time, but not the whole delivery path. Distinguish intentional wait for an active
answer from transcription latency.

Replay consented short, long and noisy recordings from the actual microphone,
including ECS/EKS, EC2/S3, negation, numbers, identifiers, pauses and final words.
Measure stop-to-text and stop-to-send p50/p95, ordinary word error rate, critical
term error rate, fallback frequency, judge frequency, and truncated/lost words.
Exercise chat switches, edits while queued, network failures and repeated retry.

A practical initial target is stop-to-usable-text p50 below one second and p95
below two seconds on healthy connections, excluding waiting for an existing
answer. These are proposed targets, not achieved results. Instrument first, then
ship delivery safety and critical-word checks, followed by deadline-based fallback
behind a setting. Compare accuracy and latency before changing Auto's defaults.

Relevant code: `web-app/src/lib/dictation.ts`, `dictationJudge.ts`,
`dictationFixes.ts`, `dictationDelivery.ts`, `speakerLive.ts`,
`web-app/src/containers/ChatInput.tsx`, `DictationIndicator.tsx`, and
`relay/server.mjs`. Existing dictation tests cover recording, consensus, judge
fallback, retries and prompt delivery; they do not benchmark real device latency
or speech accuracy.
