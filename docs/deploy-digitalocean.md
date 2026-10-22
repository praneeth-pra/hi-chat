# Deploying Hi-chat on DigitalOcean (Bangalore)

Hi-chat runs as one container: nginx serves the web app and proxies to the
Node relay (`relay/server.mjs`) next to it. `.do/deploy.template.yaml` runs
that container on DigitalOcean App Platform in Bangalore (`blr`), built from
the Dockerfile and redeployed on every push to `main`.

## 1. Create the app

Either:

- **Button:** open
  https://cloud.digitalocean.com/apps/new?repo=https://github.com/praneeth-pra/hi-chat/tree/main
  (reads `.do/deploy.template.yaml`), or
- **By hand:** Apps → Create App → GitHub → `praneeth-pra/hi-chat`, branch
  `main`, autodeploy on. Region **Bangalore**, Dockerfile build, HTTP port
  `8080`, health check `/healthz`, size 1 GB.

Authorize DigitalOcean's GitHub app for the repo when asked.

## 2. Environment variables

On the Environment Variables step, open **Bulk Editor** and paste the keys,
one `KEY=value` per line, then tick **Encrypt** on each. Railway's
Variables → Raw Editor shows the current set. Railway's Oct 21 security
notice recommends rotating them, so use fresh keys where you can.

| Variable | What it's for |
|---|---|
| `LOGIN_EMAIL` | The one address that can sign in (required) |
| `RESEND_API_KEY` | Sends the sign-in code |
| `EMAIL_FROM` | Optional sender, default `Hi-chat <login@hi-techie.dev>` |
| `AUTH_SECRET` | Signs the login cookie and the extension's camera key. Without it, a key derived from `RESEND_API_KEY` is used, so changing either signs you out and changes the extension key |
| `ELEVENLABS_API_KEY` | Main dictation engine |
| `XAI_API_KEY` | Grok dictation engine |
| `META_API_KEY` | Muse live engine (optional) |
| `SONIOX_API_KEY`, `CARTESIA_API_KEY` | Optional engines |
| `EXA_API_KEY` | Accuracy mode web search (optional) |
| `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_KEY_TOKEN` | TURN for the screen and camera (optional) |
| `CAMERA_ICE_SERVERS` | Optional fixed STUN/TURN list (JSON) |

`PORT=8080` is set by the spec; leave it.

## 3. Check it

When the deploy is live, open the `*.ondigitalocean.app` URL: sign in, try
dictation, an answer, `/mirror` and the shared screen.

## 4. Move chat.hi-techie.dev

1. App → Settings → Domains → Add `chat.hi-techie.dev`. DigitalOcean shows
   a CNAME target.
2. Where the domain's DNS is managed (Railway's domain settings, or
   Cloudflare once moved there), point `chat` at that target and remove
   Railway's record for it.
3. DigitalOcean issues the certificate once the record resolves (minutes).
   The Mac and Windows apps and the extension keep working, since they use
   the same address.

## Rolling back

Point `chat` back at Railway's target; the Railway service keeps running
the last deploy. Each DigitalOcean deploy can also be rolled back from the
app's Activity tab.
