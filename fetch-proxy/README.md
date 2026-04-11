# chat-ui fetch proxy

A sandboxed URL fetch proxy for `chat-ui`, deployed as a [Cloudflare Worker](https://developers.cloudflare.com/workers/). It runs in a V8 isolate on Cloudflare's edge — completely separated from the main app's network namespace, environment variables, and secrets.

## Why

The `/api/fetch-url` endpoint in chat-ui proxies arbitrary user-supplied URLs so the browser can load attachments without hitting CORS. Even though it has strong SSRF protections (private-IP blocking, DNS rebinding prevention), the actual outbound fetch still runs in the main Node.js process. Any bypass would expose `OPENAI_API_KEY`, `MONGODB_URL`, OIDC secrets, and the internal Docker network.

Running the fetch inside a Cloudflare Worker gives true network isolation for free: the Worker's egress is Cloudflare's edge network, which can't route to our internal services. A bypass inside the Worker reaches only the public internet.

## How it works

```
┌─────────────────┐  HTTPS + secret   ┌──────────────────┐    HTTPS    ┌──────────┐
│   Main App      │ ────────────────► │ Cloudflare       │ ──────────► │ External │
│  (SvelteKit)    │                   │ Worker (V8)      │             │   URL    │
└─────────────────┘                   └──────────────────┘             └──────────┘
```

The main app delegates to this Worker when `FETCH_PROXY_URL` is set in its environment. Otherwise it falls back to the existing in-process fetch path — so self-hosted users and local dev continue to work unchanged.

## API

### `GET /fetch?url=<encoded-url>`

Headers:

- `X-Proxy-Secret: <secret>` — must match the Worker's `FETCH_PROXY_SECRET` secret.

On success, returns the upstream body as `application/octet-stream` plus:

- `X-Original-Content-Type` — upstream `Content-Type`
- `X-Original-Status` — upstream HTTP status
- `X-Final-Url` — final URL after redirect following
- `Content-Disposition` — passed through if the upstream supplied one

Enforced limits (configurable via `wrangler.toml`):

- `MAX_RESPONSE_BYTES` — default 10 MB
- `FETCH_TIMEOUT_MS` — default 30 000
- `MAX_REDIRECTS` — default 5

### `GET /health`

Returns `200 ok`. No auth required.

## Security

- **HTTPS only.** HTTP, FTP, file, javascript schemes are rejected.
- **Hostnames only.** Raw IPv4 / IPv6 literals are rejected — a hostname is required. Cloudflare's edge network cannot route to RFC1918 addresses anyway, but we keep the string-level check as defence-in-depth.
- **Redirect re-validation.** Every `Location` header is re-parsed and re-validated before we follow it. Max 5 hops by default.
- **Size cap enforced mid-stream.** The body reader aborts the upstream connection as soon as the cumulative byte count exceeds `MAX_RESPONSE_BYTES`, so a large response never fully buffers.
- **Constant-time secret comparison.** Avoids leaking secret length or prefix via timing.
- **Strict response headers.** `CSP default-src 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` on every response.

## Deploy

1. Install dependencies:
   ```bash
   cd fetch-proxy
   npm install
   ```
2. Authenticate wrangler against your Cloudflare account:
   ```bash
   npx wrangler login
   ```
3. Generate a strong random secret and upload it:
   ```bash
   # macOS/Linux
   openssl rand -base64 48 | npx wrangler secret put FETCH_PROXY_SECRET
   ```
4. Deploy the Worker:
   ```bash
   npx wrangler deploy
   ```
   Wrangler will print the Worker URL (for example `https://chat-ui-fetch-proxy.<account>.workers.dev`).
5. Configure the main chat-ui app. In `.env.local`:
   ```bash
   FETCH_PROXY_URL=https://chat-ui-fetch-proxy.<account>.workers.dev
   FETCH_PROXY_SECRET=<the same value you put in step 3>
   ```

## Develop locally

```bash
cd fetch-proxy
npm install
npm run dev   # starts wrangler dev on http://localhost:8787
```

Create a `.dev.vars` file next to `wrangler.toml` with your local secret so `wrangler dev` can pick it up. Do not commit it — `.gitignore` already excludes it.

```
FETCH_PROXY_SECRET=dev
```

Quick smoke test:

```bash
# Health check
curl http://localhost:8787/health

# Authorized fetch
curl -H "X-Proxy-Secret: dev" \
  "http://localhost:8787/fetch?url=https%3A%2F%2Fexample.com"

# Unauthorized
curl -H "X-Proxy-Secret: wrong" \
  "http://localhost:8787/fetch?url=https%3A%2F%2Fexample.com"

# SSRF attempt
curl -H "X-Proxy-Secret: dev" \
  "http://localhost:8787/fetch?url=https%3A%2F%2Flocalhost%2Fadmin"
```

## Tests

```bash
npm test
```
