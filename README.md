# Jan (web build)

A web-only fork of [Jan](https://github.com/janhq/jan). The chat app runs in
the browser, keeps threads and assistants in browser storage, and talks to
Groq. It can also turn the Mac's own sound (through a BlackHole loopback
device) into prompts by transcribing each spoken clip.

## Layout

- `web-app/` - the React app (built with `vite.config.web.ts`)
- `core/` - `@janhq/core`, shared types and extension base classes
- `extensions-web/` - browser storage for threads and messages
- `relay/` - small Node server for `/api/transcribe` that forwards clips to
  ElevenLabs and Grok, keeping the API keys on the server
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
docker build -t hi-chat .
docker run -p 8080:8080 -e PORT=8080 \
  -e LOGIN_EMAIL=... -e RESEND_API_KEY=... \
  -e ELEVENLABS_API_KEY=... -e SONIOX_API_KEY=... -e CARTESIA_API_KEY=... hi-chat
```

The whole site sits behind a login: a 6-digit code is emailed to
`LOGIN_EMAIL` through Resend (`RESEND_API_KEY`). Without `LOGIN_EMAIL` nobody
can sign in. The Groq and Cerebras API keys are entered in the app.

## License

Apache 2.0, see [LICENSE](LICENSE).
