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

The [repository audit](docs/repository-audit-2026-10-12.md) documents security,
storage, loading and UI improvements, validation, and remaining risks.

Answers default to a useful medium length, mostly bullet points, with no tabular
layouts. Structure adapts to the question instead of repeating fixed sections;
interview answers favor first-person phrasing without inventing past experience.
Use the header list icon to extract a copyable question list from that
chat's prompts on demand. Sidebar trash buttons delete immediately; the header
trash button opens confirmation.

## Mac app

Hi-chat for Mac (`mac-app/`) is a small Swift app around the site, with the
shortcuts built in. Download it from
[the latest release](https://github.com/praneeth-pra/hi-chat/releases/latest/download/Hi-chat.dmg);
it offers each new version itself. It lives in the menu bar at the top (its H logo: Check for Updates, Show in Dock, Quit); the Dock icon is off unless "Show in Dock" is ticked.

- tap **Left Control**: dictate; tap again to send. **Escape** throws it away.
- tap **Left Option**: type into Hi-chat while the app you're in stays active. Meanwhile the mouse moves Hi-chat's own blue cursor and your pointer stays where it is: click and drag to highlight text in Hi-chat, double click for a word.
- **fn + Right**: send. **fn + Up / Down**: code block above / below.
- **fn + Shift + Up / Down**: scroll the chat. Hold **fn** and scroll: scroll Hi-chat.
- **Z**: your real pointer jumps into Hi-chat's message box (typing on), and a lookalike pointer stays where it was; **X**: pointer and keyboard back to where they were. **fn + Z / X** (or Shift) types the letter.
- **fn + Left**: live mirror window; **fn + Shift + Left** closes it.
- **fn + N**: a new chat.

The shortcuts need Accessibility, the mirror needs Screen Recording.
GitHub Actions (`.github/workflows/mac-app.yml`) builds the DMG on every change.

## Windows app

Hi-chat for Windows (`windows-app/`) is the same app in C# with WebView2,
published as one `Hi-chat.exe` in the `win-1.0.N` releases. The first run
installs it for your Windows user (Start menu entry, no admin). After that it
offers each new version itself, and Check for updates is on the tray icon's menu.
Its shortcuts:

- tap **Ctrl**: dictate; tap again to send. **Escape** throws it away.
- **Z**: the pointer goes to Hi-chat's message box (typing on); **X**: pointer and keyboard back.
- **Alt + Z / X** types the letter.
- **Ctrl + Alt + Left**: live mirror window; **Ctrl + Alt + Shift + Left** closes it.

Closing the window keeps Hi-chat running in the tray so the shortcuts keep
working; Quit is on the tray icon's menu. GitHub Actions
(`.github/workflows/windows-app.yml`) builds it on every change.

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
