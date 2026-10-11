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

The speaker uses a conversation buffer, not one prompt per audio clip. The
judge receives the accumulated interviewer turn and the active question, then
returns `ignore`, `hold`, or `question` with a current/new topic relation. Only
accepted interviewer speech enters the conversation history. Candidate answers
and chatter are rejected; technical vocabulary alone cannot authorize sending.
The judge selects original transcript words by index, without rewriting them.

Complete questions send automatically. Related follow-ups revise the same
question ID and answer; a genuinely separate topic creates a new question.
Incomplete scenarios survive pauses and accumulate without background review
cards. A final fragment can complete a question begun in an earlier clip.
Bare “What do you think?” needs surrounding context before it can send.

The 500 ms settling window overlaps transcription and judgement, measured from
that contribution's immutable clip endpoint. Smart Turn can extend it to one
second for unfinished intonation. Later capture or queued judgement does not
block an already complete question. A valid primary decision needs no second
model; failed/invalid decisions get at most one recovery attempt. Endpointing,
transcription, provider processing and answer generation still add latency.

Only the latest review card appears. **Add** updates the current question;
**Send now** explicitly sends a new draft. Cards hide after three seconds;
hiding never deletes accumulated context. Later relevant speech can complete a
hidden draft. **Discard** explicitly removes it. An uncertain standalone
recommendation uses **Send as new**, preserving its separate question boundary.

Speaker logs record `conversation-v1`, endpoint configuration, invalid fields,
provider finish reason and recovery outcome. Stage timestamps distinguish clip
finalization, transcript readiness, decision readiness, settling, queueing,
sending and first answer content. Commit origin distinguishes automatic sends,
Send now and clicked recommendations. Recommendation creation/suppression and
review hiding are logged. Capture end is the audio endpoint, not the last word.
No raw judge replies or credentials are logged.

Related updates retain the previous answer until a replacement is ready.
Switching chats, typing a question or disabling Speaker cancels stale automatic
work. Dictation retains its separate microphone flow. Smart Turn remains
optional; a stalled model load cannot block text decisions.

## Hammerspoon speaker shortcuts

The updated version of the supplied Mac script is
`scripts/hammerspoon/jan-remote.lua`. Replace the corresponding script on your
Mac with this file and reload Hammerspoon. **fn + Right** accepts the visible
card (Add or Send); **fn + Left** discards it. Plain Left/Right arrows remain
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
