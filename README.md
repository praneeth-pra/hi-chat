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

## Automatic speaker questions

The speaker uses an intent protocol with three outcomes: ignore non-question
speech, hold an unfinished scenario, or answer a complete interviewer request.
A separate current/new topic relation lets the app assemble scenario fragments
and update genuine follow-ups in the existing question and answer. The model
selects a transcript or an exact question span; it does not rewrite the question
or produce a separate completeness flag or explanatory text.

Clear questions send automatically. Incomplete scenarios survive long pauses.
The 500 ms settling window overlaps transcription and judgement; optional Smart
Turn can extend it to one second for unfinished intonation. Audio endpointing
and provider processing still add latency. Smart Turn runs on WASM, reports
readiness/failure, and becomes unavailable after a 30-second stalled load without
blocking text decisions.

Use **Send now** (or F16) for a pending question, **Keep listening** for an
explicit manual hold, or **Discard**. A clicked recommendation is labelled
**Send as new** and always starts a separate question; it cannot silently append
older speech or a candidate answer to an existing answer. Unsent scenario
context is preserved as a recommendation when necessary.

Automatic assembly needs a configured judgement provider. OpenAI-compatible
providers receive a strict response schema, with cached JSON-object fallback
only when a provider explicitly rejects schema support. Malformed decisions
get at most one recovery attempt; invalid intent/topic/transcript selection
never becomes automatic sending. Failures produce recommendations with reasons.
A valid primary intent requires no second-model wait. The optional second model
can recover an invalid or failed primary decision.

Speaker logs record protocol version, endpoint configuration, invalid fields,
provider finish reason and recovery outcome. Stage timestamps distinguish
capture end, transcript readiness, decision readiness, settling, queueing,
sending and first answer content. Commit origin distinguishes automatic sends,
Send now and clicked recommendations. Capture-end timestamps refer to the audio
endpoint boundary, not the last audible word. No raw judge replies or credentials
are logged. Legacy clip benchmarks remain comparison tools for the old filter.

Related updates retain the previous answer until a replacement is ready.
Switching chats, typing a question or disabling Speaker cancels stale automatic
work. Dictation retains its separate microphone flow.

## Hammerspoon speaker shortcuts

The updated version of the supplied Mac script is
`scripts/hammerspoon/jan-remote.lua`. Replace the corresponding script on your
Mac with this file and reload Hammerspoon. **fn + Right** sends the newest
recommendation as a new question; **fn + Left** discards it. These commands use
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
