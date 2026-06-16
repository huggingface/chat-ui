# Common Issues

## 403: You don't have access to this conversation

This usually happens when running Chat UI over HTTP without proper cookie configuration.

**Recommended:** Set up a reverse proxy (NGINX, Caddy) to handle HTTPS.

**Alternative:** If you must run over HTTP, set the following env var:

```ini
COOKIE_SECURE=false
```

This automatically sets `COOKIE_SAMESITE` to `lax`, which is the correct value for HTTP deployments.

Also ensure `PUBLIC_ORIGIN` matches your actual URL:

```ini
PUBLIC_ORIGIN=http://localhost:5173
```

## Models not loading

If models aren't appearing in the UI:

1. Verify `OPENAI_BASE_URL` is correct and accessible
2. Check that `OPENAI_API_KEY` is valid
3. Ensure the endpoint returns models at `${OPENAI_BASE_URL}/models`

### `MODELS` variable not parsed correctly

If you customise the model list via the `MODELS` variable and models don't appear, check that you are using the backtick multiline syntax correctly:

```ini
# Correct — backtick immediately after = on the opening line,
# closing backtick alone on the last line
MODELS=`[
  { "id": "my-model", "name": "My Model" }
]`
```

Common mistakes:

- Missing the opening or closing backtick entirely
- Putting a space between `=` and the opening backtick (`MODELS= \`[` is invalid)
- Editing `.env` directly instead of `.env.local` (your change gets overwritten on `git pull`)

## Database connection errors

For development, you can skip MongoDB entirely - Chat UI will use an embedded database.

For production, verify:

- `MONGODB_URL` is a valid connection string
- Your IP is whitelisted (for MongoDB Atlas)
- The database user has read/write permissions
