# hi-chat

A small, single-user chat app for OpenAI-compatible APIs (Groq by default), inspired by Jan and Open WebUI.

- Chat history stored in SQLite (`DATA_DIR/chat.db`)
- Model picker per chat, default model and system prompt in Settings
- Streaming replies with stop, regenerate, copy and delete
- Markdown with code highlighting, light and dark themes, mobile layout
- **The view never auto-scrolls when you send a prompt or while a reply streams.** A "jump to latest" button appears instead.

## Configuration

| Variable         | Default                          | Notes                                          |
| ---------------- | -------------------------------- | ---------------------------------------------- |
| `APP_PASSWORD`   | none                             | Required in production. Sign-in password.      |
| `LLM_API_KEY`    | none                             | API key (`GROQ_API_KEY` also works).           |
| `LLM_BASE_URL`   | `https://api.groq.com/openai/v1` | Any OpenAI-compatible endpoint.                |
| `DEFAULT_MODEL`  | `llama-3.3-70b-versatile`        | Used until changed in Settings.                |
| `DATA_DIR`       | `./data` (`/data` in Docker)     | Database and session secret. Mount a volume.   |
| `PORT`           | `3000`                           |                                                |
| `SESSION_SECRET` | generated into `DATA_DIR`        | Optional. Set to keep sessions across volumes. |

## Development

Requires Node 22.13 or newer.

```sh
npm install
LLM_API_KEY=... npm run dev     # web on :5173, API on :3000
npm test                        # vitest (server + web)
npm run typecheck && npm run format:check
```

## Deploy (Railway)

The repo includes a `Dockerfile` and `railway.json` (health check on `/api/health`).
Create a service from this repo, attach a volume at `/data`, and set `APP_PASSWORD` and `LLM_API_KEY`.
Every change goes through a pull request and must pass CI before it is deployed.
