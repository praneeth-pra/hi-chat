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
- tap **Left Option**: a silent screenshot of the laptop's own screen, wherever the pointer is (on a Mac without one, the screen the pointer is on), put in Hi-chat's message box for you to send with Enter (taken while dictating, it goes out with the dictated message). It's also saved where your Mac saves screenshots (the Desktop by default) and copied. The first time, macOS asks to allow Screen Recording.
- **fn + Right**: send. **fn + Up / Down**: code block above / below.
- **fn + Shift + Up / Down**: scroll the chat. Hold **fn** and scroll: scroll Hi-chat.
- **Z**: your real pointer jumps into Hi-chat's message box (typing on), and a lookalike pointer stays where it was; **X**: pointer and keyboard back to where they were. **fn + Z / X** (or Shift) types the letter.
- **fn + Left**: live mirror window; **fn + Shift + Left** closes it.
- **fn + N**: a new chat.

With a monitor connected, Hi-chat's window goes on the monitor; otherwise it
goes on the laptop's screen. Both apps do this at start, when a monitor is
plugged in or out, and whenever Hi-chat brings its window up. Unplugging the
monitor hides Hi-chat instead of moving it to the laptop's screen; it comes
back when the monitor is plugged in again, or when you open it yourself. The
mirror window does the same, and both come back exactly where they were.

The shortcuts need Accessibility, the mirror needs Screen Recording.
GitHub Actions (`.github/workflows/mac-app.yml`) builds the DMG on every change.

These are the defaults. Each can be changed, turned off or reset in Hi-chat's **Settings > App keys**: press Change, then press the new keys (a key with modifiers, or a modifier tapped on its own). Esc cancels.

### Signed updates

Both apps install an update only when its download carries a valid signature
(`Hi-chat.dmg.sig`, `Hi-chat.exe.sig`: ECDSA P-256 over the file's SHA-256)
from Hi-chat's own key, and the Mac app also only when the new app is signed
with Hi-chat's own certificate. Both live in the repository secret
`HICHAT_SIGNING` (a base64 tar of `update.pem`, `mac.p12` and `p12pass`); the
public halves are in the apps' `Updater`. Releases from main fail without it.
Keep it as a secret of the `release` environment (Settings > Environments),
with deployments limited to `main`, so pull request builds can never read it;
they build unsigned.

## Windows app

Hi-chat for Windows (`windows-app/`) is the same app in C# with WebView2,
published as one `Hi-chat.exe` (about 1 MB) in the `win-1.0.N` releases. It
runs on .NET Framework 4.8, which comes with Windows 10 (1903 and later) and 11,
so there's nothing else to install, and WebView2's DLLs are packed inside it
(`windows-app/Compat.cs`). The first run
installs it for your Windows user (Start menu entry, no admin). After that it
offers each new version itself, and Check for updates is on the tray icon's menu.
Its shortcuts:

- tap **Left Ctrl**: dictate; tap again to send. **Escape** throws it away.
- tap **Right Ctrl**: a silent screenshot of the laptop's own screen, wherever the pointer is (on a PC without one, the screen the pointer is on), put in Hi-chat's message box for you to send with Enter (taken while dictating, it goes out with the dictated message). It's also saved to Pictures\Screenshots and copied.
- **Z**: the pointer goes to Hi-chat's message box (typing on), and a lookalike pointer stays where it was; **X**: pointer and keyboard back.
- **Alt + Z / X** types the letter.
- **Page Up / Down** (Fn + Up / Down on most laptops): the code block above / below in Hi-chat; with **Shift**, the chat scrolls by most of a screen.
- **Alt + scroll** (two fingers on the touchpad, or a mouse wheel): scrolls Hi-chat from anywhere. Windows can't see the Fn key, so Alt stands in for Mac's fn + scroll.
- **Ctrl + Left**: live mirror window of Hi-chat; again to switch to the screen around the pointer and back. **Ctrl + Shift + Left** closes it.

Closing the window keeps Hi-chat running in the tray so the shortcuts keep
working; Quit is on the tray icon's menu. GitHub Actions
(`.github/workflows/windows-app.yml`) builds it on every change.

See [Question input alternatives and answer latency](docs/question-input-alternatives.md)
for the assessed replacement options; no replacement listener is enabled.

These are the defaults. Each can be changed, turned off or reset in Hi-chat's **Settings > App keys**: press Change, then press the new keys (a key with modifiers, or a modifier tapped on its own). Esc cancels.

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
