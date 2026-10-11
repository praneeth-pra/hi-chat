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

## Speaker question turns

Speaker capture assembles a question before sending it. Scenario/background
clips remain in a pending preview across pauses, including long pauses. A
complete question waits 500 ms after transcription and judgement finish and
capture becomes idle, so an immediate continuation can join it. Optional Smart
turn detection extends this settling period to 5 seconds when the audio sounds
unfinished; it does not make incomplete scenarios expire into automatic sends.

Use **Send now** (or F16) to commit the pending question, **Keep listening** to
hold it until you explicitly send, and **Discard** to clear it. Related
follow-ups update the same question and answer, even after an answer finishes.
The previous answer remains stored and visible while its update is generated;
obsolete generations cannot replace a newer answer. A clearly different topic
starts a new question. Typing a question, switching chats or disabling Speaker
clears pending automatic work. Dictation retains its separate microphone flow.

Automatic assembly needs a configured judgement provider. Missing credentials,
provider failures, conflicting judges or malformed decisions produce manual
suggestions rather than guessed questions. The turn judge uses up to three
transcripts in one request and keeps conversation context consistent across
provider fallbacks. The old clip-filter benchmarks in Settings are labelled as
legacy comparisons; they do not measure the new turn coordinator or audio.

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
