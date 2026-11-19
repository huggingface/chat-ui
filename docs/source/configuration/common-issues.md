# Common Issues

## 403: You don't have access to this conversation

This usually happens when running Chat UI over HTTP without proper cookie configuration.

**Recommended:** Set up a reverse proxy (NGINX, Caddy) to handle HTTPS.

**Alternative:** If you must run over HTTP, set the following env var:

```ini
COOKIE_SECURE=false
```

This automatically sets `COOKIE_SAMESITE` to `lax`, which is the correct value for HTTP deployments.

Also ensure `PUBLIC_ORIGIN` matches your actual URL (**no trailing slash**):

```ini
PUBLIC_ORIGIN=http://localhost:5173
```


## Favicons / logos use https:// over plain HTTP (Docker)

SvelteKit's **adapter-node** forces `page.url.origin` to `https://` in production unless you set its own `ORIGIN` (or `PROTOCOL_HEADER` / `HOST_HEADER`) env var. `PUBLIC_ORIGIN` alone does **not** change that, so favicons and logos can break when you serve Chat UI over plain HTTP in Docker.

For HTTP Docker deployments, set both (no trailing slash on either):

```ini
PUBLIC_ORIGIN=http://localhost:3000
ORIGIN=http://localhost:3000
COOKIE_SECURE=false
```

Notes:

- Do **not** leave `ORIGIN=` empty — adapter-node rejects `Invalid ORIGIN: ''`.
- Prefer setting `ORIGIN` explicitly rather than copying it from `PUBLIC_ORIGIN` automatically: a forced `ORIGIN` also scopes CSRF checks to that host.
- Alternatively, behind a reverse proxy that injects `X-Forwarded-Proto` / `X-Forwarded-Host`, you can use `PROTOCOL_HEADER` and `HOST_HEADER` as documented by [@sveltejs/adapter-node](https://github.com/sveltejs/kit/tree/main/packages/adapter-node#environment-variables).
- A trailing slash on `PUBLIC_ORIGIN` (e.g. `http://host:3000/`) produces broken asset URLs like `//chatui/favicon.svg`. Chat UI strips a trailing slash when the config loads.

## Models not loading

If models aren't appearing in the UI:

1. Verify `OPENAI_BASE_URL` is correct and accessible
2. Check that `OPENAI_API_KEY` is valid
3. Ensure the endpoint returns models at `${OPENAI_BASE_URL}/models`

## Database connection errors

For development, you can skip MongoDB entirely - Chat UI will use an embedded database.

For production, verify:

- `MONGODB_URL` is a valid connection string
- Your IP is whitelisted (for MongoDB Atlas)
- The database user has read/write permissions
