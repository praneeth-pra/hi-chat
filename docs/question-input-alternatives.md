# Question input alternatives and answer latency

## Recommendation

Remove the continuous Speaker feature and keep deliberate microphone dictation.
For interview questions, the best next experiment is **selecting text from the
meeting's captions and sending that selection to chat**. Use the meeting tool's
captions/transcript when it makes text available to copy. Where copying is not
supported, validate an accessible transcript source before investing in an
integration. No replacement listener or caption integration is implemented here.

This addresses the failures at their source: the user selects the question's
boundaries. Pauses do not trigger a send, drafts do not expire, classification
cannot split a scenario, and live words do not occupy the composer. A follow-up
becomes a separate message and can use the conversation already in chat as
context. It never changes a previously sent question or answer.

A future integration should show stable finalized caption lines in an optional
transcript panel. Selecting several lines creates one editable prompt. Nothing
sends before approval. Caption revisions update the transcript, not the selected
prompt. Preserve timestamps and source line IDs so text can be checked without
an LLM deciding what was said. Keep transcripts scoped to the current session and
provide an explicit clear action; no permanent recording is required.

## Feasible options

| Option | Long scenarios and follow-ups | Latency | Effort and limits |
| --- | --- | --- | --- |
| Meeting captions → selected text → chat | Select as many lines as needed across pauses; send follow-ups separately | Avoids this app's transcription and judge calls; caption generation still takes time | Lowest-risk experiment. Depends on readable/copyable captions; meeting app support varies. Technical terms may still need correction. |
| Existing deliberate dictation | Record while stating the question; stop once the entire question is ready | Streams during recording; stopping still needs finalization and sometimes transcript reconciliation | Available now. Requires repeating or speaking the question. Acoustic playback through the mic depends on room/input conditions. |
| On-demand native Mac audio capture | Start and stop one recording explicitly, then send a finalized editable transcript | Can stream while capturing; measure finalization time on the actual Mac | Larger build. ScreenCaptureKit/system-audio feasibility depends on macOS version, permissions and meeting app. No automatic semantic boundaries. |

The caption-selection option is the strongest match for reliability and low
application overhead. Try it with real multi-part scenarios and short follow-ups
before adding software. If the meeting app cannot expose usable captions and
repeating questions is too intrusive, prototype native on-demand capture. Avoid
reintroducing automatic question/topic judgement under a new name.

## What removal changes

The app no longer opens BlackHole, segments call audio, downloads Smart Turn,
classifies speech, builds review queues or overlays Speaker drafts in the prompt
box. Speaker settings, tests/fixtures, and recommendation shortcuts are retired.
Persisted Speaker enablement no longer has any code path that can start capture.
Existing chats/answers and saved transcription vocabulary are retained.

Shared live transcribers, token retrieval, audio conversion, microphone choice,
dictionary and transcript reconciliation remain for dictation. Microphone readiness
is still controlled by dictation's existing setting. Coding mode, ordinary chat,
attachments, model selection, answer streaming and unrelated Hammerspoon helpers
are preserved. Update the Mac script separately to release its old fn-arrow and
Left Option bindings; deploying the web app alone cannot change Hammerspoon.

## Can answers arrive sooner?

The follow-on [Auto modes](auto-modes.md) implementation now provides Speed and
Accuracy races using only Groq and Cerebras. The review below describes the
previous ordered fallback design and the reasons for replacing it. Speaker input
alternatives remain proposals; no replacement listener has been added.

Yes, there are concrete opportunities. Streaming is **already enabled by default**:
`useChat.ts` defaults `streamReply` to true unless the assistant explicitly sets
`parameters.stream=false`; `completion.ts` uses streamed completions; the Claude
adapter requests `stream:true`. Nginx disables buffering for the relevant model
proxy routes. Enabling streaming again is not a new optimization.

Measure two outcomes separately:

- **Time to first visible answer:** when useful answer text actually appears.
- **Time to complete answer:** when the response finishes.

Reasoning/role/metadata chunks do not count as a visible answer. Existing timing
code distinguishes first chunk and first answer content, but does not separately
record the browser's first rendered answer. This is a code review, not a fresh
production benchmark; no numerical speedup is established.

### Improvements already available through settings

1. Confirm streaming is enabled for the assistant. A disabled stream waits for the
   full response and cannot display incremental output.
2. Test Cerebras gpt-oss-120b and Groq gpt-oss-20b against the current Claude choice
   using Settings > Answer model test and representative questions. The smaller
   model is a candidate for routine questions, with a possible accuracy tradeoff.
   The current answer benchmark compares Claude/Cerebras, so Groq 20b also needs a
   representative manual run or an expanded benchmark. Do not assume the fastest
   provider from a name alone.
3. Keep Chat thinking at Low for gpt-oss where appropriate; Low is already the
   default, so changing an already-low setting cannot improve it further. Use
   Medium for difficult questions when the extra reasoning is worthwhile.
4. Ask for a concise direct answer first, followed by details. This mostly reduces
   total generation time and gets useful information into the early output.
5. Compare a short chat with the same question in a long thread. Long histories,
   assistant documents, tool discovery/calls and model startup can add time before
   generation. A fresh chat helps only when it retains the context the question needs.

### Highest-value engineering change: choose a useful response, not any chunk

`chatModels.ts:streamWithFallback` currently accepts the first iterator chunk as
success. That may only be a role, metadata or reasoning chunk. Once accepted, the
other running model is aborted. With Claude selected, the fallback can already be
running, but remains held behind the primary's 1.5-second wait (2.5 seconds for
Sonnet); this is not a fastest-useful-answer race.

A future latency change should gate success on the **first useful answer delta**,
while also treating an actionable tool call as valid progress. Buffer pre-answer
chunks for each attempt, use a measured short hedge delay for a backup model, then
choose one winner and cancel the other. Replay the winner's buffered chunks once
and never mix two models' answers. Test cancellation, reasoning-only streams,
empty streams, tool calls and errors before changing defaults. Racing can increase
provider cost because losing requests may already have generated tokens.

This is more promising for slow first answers than toggling streaming. Compare
median and p95 first visible answer time, completion time, correctness and cost
with the same questions/settings. Use a latency goal after measuring the baseline;
no subsecond promise is justified by the available logs.

### Additional bottlenecks to investigate

- **Background window rendering:** updates use requestAnimationFrame, which can be
  throttled when the document is hidden. The user's remote-window setup makes this
  worth measuring. Flush on visibility return and use a bounded timer fallback if
  actual traces show delayed rendering; avoid making every token a React update.
- **Prompt prefill:** all relevant chat history and assistant documents go into the
  request. Provider prompt caching and limiting/retrieving relevant document text
  may reduce repeated prefill work, but support and context quality need validation.
- **Preparatory work:** trace model readiness, attachment processing and proactive
  screenshot/tool setup before the request. These are feature-dependent delays;
  disabling them globally would change other functionality.
- **Progress delay:** streaming deliberately sleeps 100 ms for each prompt_progress
  event. This appears relevant to progress-reporting/local models; do not treat it
  as proven cloud-model delay.
- **Network/fallback transport:** Groq already has direct/proxy handling. Nginx
  buffering is already disabled. Measure request start, connection, first answer
  delta and first rendered text before changing transport.

## Validation and scope

The removal is verified with chat/dictation/keyboard regressions, the web suite,
relay tests and production web build. Native Mac microphone/audio performance,
actual Hammerspoon rendering and provider timing require the user's Mac or live
instrumentation. Alternative input designs and answer-speed changes are proposals;
this PR implements Speaker removal and the shared-code separation only.
