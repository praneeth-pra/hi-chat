# Jan (web build)

A web-only fork of [Jan](https://github.com/janhq/jan). The chat app runs in
the browser, keeps threads and assistants in browser storage, and talks to
Groq and other configured models. Microphone dictation turns speech into prompts.
The continuous Speaker listener has been removed.

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

## Dictation

Tap Left Control or click the mic button to record; tap or click again to stop,
transcribe and send. Playback suppression is off by default so the selected
microphone can capture played speech as well as your voice. Settings > Dictation
offers a microphone selector, optional echo suppression, engine selection,
Keep microphone ready and your dictionary. Assistant key terms remain available
to dictation's live engines without any background question listener.

Recognized dictation appends to the prompt box and automatically sends through
its own queue. If an answer is streaming, text waits until the chat can send it.
An error restores the text for retry. The external F20-then-paste dictation path
also uses the dictation queue. Ordinary text pastes remain drafts.

## Hammerspoon shortcuts

The Mac script is `scripts/hammerspoon/jan-remote.lua`. Replace your local copy
and reload Hammerspoon; a Railway deployment cannot update a script on your Mac.
The script retains scrolling, fn + Up/Down code navigation, Left Control dictation,
fn + Return sending, Z/X and the native-sized dummy cursor. The retired Speaker
Option toggle and fn + Left/Right recommendation shortcuts are removed. Ordinary
arrows and fn + Left/Right pass through to the app in front.

Coding mode remains available as its own chat toolbar button and F18 shortcut.
There is no Speaker capture, review UI, question judge, background microphone
turn detector or Smart Turn model download.

See [Question input alternatives and answer latency](docs/question-input-alternatives.md)
for the assessed replacement options; no replacement listener is enabled.

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
needs all three keys. Keys for Groq, Cerebras and Anthropic chat models are
entered in the app under Model Providers.

## License

Apache 2.0, see [LICENSE](LICENSE).

The dummy cursor uses macOS’s native arrow image, logical dimensions and hotspot,
with Accessibility cursor scaling. Update the Mac script and reload Hammerspoon
to apply this change. Run `lua scripts/hammerspoon/test-native-cursor.lua` for the
portable cursor sizing checks; actual rendering needs a Mac.
