import { serve } from '@hono/node-server';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { Store } from './db.js';
import { createOpenAiCompatibleClient } from './llm.js';

const env = process.env;
const dataDir = resolve(env.DATA_DIR ?? 'data');
mkdirSync(dataDir, { recursive: true });

/** Session secret: env var, else a random one persisted next to the database. */
function loadSessionSecret(): string {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  const file = join(dataDir, '.session_secret');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  return readFileSync(file, 'utf8').trim();
}

const apiKey = env.LLM_API_KEY ?? env.GROQ_API_KEY ?? '';
if (!apiKey) console.warn('LLM_API_KEY (or GROQ_API_KEY) is not set; chat requests will fail.');

const production = env.NODE_ENV === 'production';
if (production && !env.APP_PASSWORD) {
  console.error('APP_PASSWORD must be set in production.');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const store = new Store(join(dataDir, 'chat.db'));
const llm = createOpenAiCompatibleClient(
  env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1',
  apiKey
);

const app = createApp(store, llm, {
  password: env.APP_PASSWORD,
  sessionSecret: loadSessionSecret(),
  defaultModel: env.DEFAULT_MODEL ?? 'llama-3.3-70b-versatile',
  secureCookies: production,
  webRoot: env.WEB_ROOT ?? join(here, '..', 'web')
});

const port = Number(env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`hi-chat listening on :${port}`);
});

const shutdown = () => {
  server.close();
  store.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
