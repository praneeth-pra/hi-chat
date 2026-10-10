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

## Test and build

```bash
yarn workspace @janhq/web-app test
node --test relay/server.test.mjs
yarn build:web-app      # output in web-app/dist-web
```

## Deploy

```bash
docker build -t jan-web .
docker run -p 8080:8080 -e PORT=8080 \
  -e ELEVENLABS_API_KEY=... -e XAI_API_KEY=... \
  -e SONIOX_API_KEY=... -e CARTESIA_API_KEY=... -e RELAY_TOKEN=... jan-web
```

Dictation's Auto mode streams to Cartesia, Soniox and ElevenLabs, so it
needs all three keys; the speaker uses ElevenLabs plus the engines picked in
Settings. Keys for Groq, Cerebras (the judges) and Anthropic are entered in
the app under Model Providers.

`RELAY_TOKEN` is the shared secret the browser sends to use the transcription
relay; without it the relay stays off. The Groq API key is entered in the app.

## License

Apache 2.0, see [LICENSE](LICENSE).
