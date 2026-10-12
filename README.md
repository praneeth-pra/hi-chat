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

## Auto answers

The model picker offers **Auto · Speed** and **Auto · Accuracy**, using Groq 20B,
Groq 120B and Cerebras 120B. Speed races all three with Low reasoning. Accuracy
races the two 120B models with Medium reasoning (20B is draft recovery) after
retrieving mandatory Exa Fast evidence. All draft candidates receive the sources;
a 120B reviewer checks the full answer with a validated claim audit before showing
it. Set `EXA_API_KEY` securely in Railway for Accuracy; missing sources block
generation. If the detailed audit fails, a second reviewer produces a corrected
answer with an incomplete-audit notice. If both reviews fail, the grounded draft
is shown with an explicit unverified warning. Speed streams the
first useful winner immediately. Manual model choices remain available. Parallel
requests and review increase API usage; checking does not guarantee correctness.
See [Auto modes](docs/auto-modes.md) and [Accuracy setup](docs/accuracy-mode.md).

Answers default to a useful medium length, mostly bullet points, with no tabular
layouts. Structure adapts to the question instead of repeating fixed sections;
interview answers favor first-person phrasing without inventing past experience.
Use the header list icon to extract a copyable question list from that
chat's prompts on demand. Sidebar trash buttons delete immediately; the header
trash button opens confirmation.

## Hammerspoon shortcuts

The Mac script is `scripts/hammerspoon/jan-remote.lua`. Replace your local copy
and reload Hammerspoon; a Railway deployment cannot update a script on your Mac.
The script retains scrolling, fn + Up/Down code navigation, Left Control dictation,
fn + Right sending, Z/X and the native-sized dummy cursor. The retired Speaker
Option toggle and recommendation shortcuts are removed. Plain arrows and fn + Left remain free.
Tap **Left Option** to toggle background typing into Jan; tap it again or press
Escape to stop. Jan's keyboard symbol lights up while enabled. Your main app
stays active; ordinary typing goes to Jan, including Z/X. Enter adds a newline;
fn + Right sends; fn + Return is released. Option used in a chord does not toggle the mode. The normal
Z/X navigation resumes when typing is off. Fn navigation remains available.

Before first use, select Hi-chat in Safari (or the Jan web app), then return to
your main app and tap Option. Safari must retain Hi-chat in its last selected
window/tab; the script stops routing if that changes. It posts to the application
without activating a window. Background event handling needs testing on your Mac;
Linux checks cannot verify Safari receiving input or macOS window appearance.
Only typing/editing keys are routed; Tab and non-editing Command/Control chords
exit the mode and go to the main app. Side arrows edit Jan's text while enabled
and pass through normally when disabled. The icon resets if script heartbeats stop. Typing and missing-window messages use the Hammerspoon console instead of popups.

The coding-mode toolbar button and toggle are also removed. F18/F19 now carry
explicit typing-status signals, without recording or sending. Questions asking
for code still receive the existing short-code instruction automatically.
There is no Speaker capture, speech review UI, background question judge or microphone
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
