# Jan (web build)

A web-only fork of [Jan](https://github.com/janhq/jan). The chat app runs in
the browser, keeps threads and assistants in browser storage, and talks to
Groq. It can also turn the Mac's own sound (through a BlackHole loopback
device) into prompts by transcribing each spoken clip, and turn your own
voice into prompts with dictation.

## Layout

- `web-app/` - the React app (built with `vite.config.web.ts`)
- `core/` - `@janhq/core`, shared types and extension base classes
- `extensions-web/` - browser storage for threads and messages
- `relay/` - small Node server that keeps the speech API keys on the server:
  `/api/transcribe` forwards clips to ElevenLabs and Grok (also the
  dictation fallback), `/api/live-token` hands out short-lived tokens so the
  browser can stream live to ElevenLabs, Soniox and Cartesia, and
  `/api/grok-live` relays Grok's live stream
- `nginx.conf`, `Dockerfile` - the production image (static app, Groq
  pass-through at `/api/groq/`, transcription relay)

## Develop

Requires Node.js 20+ and Yarn 4 (`corepack enable`).

```bash
yarn install
yarn build:core
yarn dev:web-app        # http://localhost:3001
```

## Speaker questions

The speaker uses a conversation buffer rather than one prompt per audio clip.
Finalized transcription enters an unsent review draft immediately. The judge runs
in the background with the accumulated turn and previous sent question, advising
on completeness and current/new topic relation. Its original-word selection and
non-question checks remain available for classification, but cannot silently
delete or rewrite the speech you are reviewing. This review flow assumes question,
scenario and follow-up audio; approval determines exactly what is sent.

Every question requires approval, including the first. Speaker proposals appear
in the existing prompt box with Send and Discard controls in its toolbar; there
are no separate cards above it. In narrow composers, review controls use the model
selector’s space; the model name stays visible in wide composers and returns when
the proposal clears. If you have typed a draft, **Review question**
switches to the proposal and **Back to draft** restores your text. Incoming
speech never overwrites the typed draft. Sending creates a separate prompt; it
never appends speech to a sent question or replaces its answer. The previous
question remains context for the judge, not text copied into the new prompt.
Incomplete scenarios survive pauses and accumulate without displaying background
cards. A final fragment can complete a question begun in an earlier clip.
Short questions retain preceding unsent scenario context.

Approval sends immediately without an additional settling timer.
A valid primary decision needs no second
model; failed/invalid decisions get at most one recovery attempt. Endpointing,
transcription, provider processing and answer generation still add latency.
Speaker finalization takes the first usable live engine result and gathers other
ready transcripts for up to 300 ms. If none arrive within 1.5 seconds, batch
fallback starts without waiting for the live timeout. Batch transcription starts
at each clip endpoint, independently of earlier questions being judged. Logs
separate clip-finalized, engine-ready, fallback-start, transcripts-ready,
capture-queue-ready and turn-check-observed stages.

One persistent unsent draft accumulates scenario fragments across pauses, without
expiring. **Send**, Enter or fn + Right approves the finalized text; **Discard**,
Escape or fn + Left removes that draft. Separate topics are retained in a review
queue; the composer shows a small “more” control when another question is held.
fn shortcuts act only on the visible proposal, leaving ordinary arrows free for
navigation. Streaming text appears as “Listening…” until finalized; approval does
not wait for the judge. The judge advises on topic and readiness, never deletes
speech or sends it. Approval always creates a separate prompt; later speech cannot
change a sent question. The user's typed draft stays separate.

Speaker logs record `conversation-v5`, endpoint configuration, invalid fields,
provider finish reason and recovery outcome. Stage timestamps distinguish clip
finalization, transcript readiness, decision readiness, settling, queueing,
sending and first answer content. Commit origin distinguishes Send now and clicked recommendations. Review discards and background judge failures are logged. Capture end is the audio endpoint, not the last word.
No raw judge replies or credentials are logged.

Speaker sends retain all earlier questions and answers.
Switching chats, typing a question or disabling Speaker cancels stale speaker
work. Dictation retains its separate microphone flow. Playback suppression is off by
default so the selected microphone can capture played speech as well as your voice.
Settings > Dictation offers an opt-in suppression switch and a microphone selector.
Dictation batch fallback requires nonempty speech before ending the engine race.
Recognized dictation
appends to the prompt box and automatically sends through its own queue even
when Speaker is disabled. While an answer is streaming, the text stays visible
until it can send; a delivery error restores the text for retry. Smart Turn remains
optional; a stalled model load cannot block text decisions.

## Hammerspoon speaker shortcuts

The updated version of the supplied Mac script is
`scripts/hammerspoon/jan-remote.lua`. Replace the corresponding script on your
Mac with this file and reload Hammerspoon. **fn + Right** accepts the visible
draft; **fn + Left** discards it. Plain Left/Right arrows remain
normal navigation. The script tracks the physical fn press because macOS can
mark plain arrow events with a secondary fn flag. These commands use
Shift + F15 / Shift + F18 and do not submit a typed draft or toggle coding.
The script retains scrolling, code navigation, dictation, fn + Return, Z/X and
speaker toggling. No Mac-side changes are applied by a Railway deployment.

## Test and build

```bash
yarn workspace @janhq/web-app test
node --test relay/server.test.mjs
yarn build:web-app      # output in web-app/dist-web
```

## Deploy

```bash
docker build -t hi-chat .
docker run -p 8080:8080 -e PORT=8080 \
  -e LOGIN_EMAIL=... -e RESEND_API_KEY=... \
  -e ELEVENLABS_API_KEY=... -e XAI_API_KEY=... \
  -e SONIOX_API_KEY=... -e CARTESIA_API_KEY=... hi-chat
```

The whole site sits behind a login: a 6-digit code is emailed to
`LOGIN_EMAIL` through Resend (`RESEND_API_KEY`). Without `LOGIN_EMAIL` nobody
can sign in.

Dictation's Auto mode streams to Cartesia, Soniox and ElevenLabs, so it
needs all three keys; the speaker uses ElevenLabs plus the engines picked in
Settings. Keys for Groq, Cerebras (the judges) and Anthropic are entered in
the app under Model Providers.

## License

Apache 2.0, see [LICENSE](LICENSE).

The word-range protocol uses `span: {start, end}` (zero-based, end exclusive)
or `null` for the whole selected transcript. Out-of-bounds or invented spans
cannot automatically send. The optional secondary judge is recovery only.

Run `lua scripts/hammerspoon/test-recommendation-shortcuts.lua` from the repo
root to exercise the actual shortcut callback, including plain-arrow rejection,
fn release, repeats and conflicting modifiers. Native Mac loading still needs
verification on the user's machine.

The dummy cursor uses macOS’s native arrow image, logical dimensions and hotspot,
with Accessibility cursor scaling. Update the Mac script and reload Hammerspoon
to apply this change. Run `lua scripts/hammerspoon/test-native-cursor.lua` for the
portable cursor sizing checks; actual rendering needs a Mac.
