# Configuration Overview

Chat UI is configured through environment variables. Default values are in `.env`; override them in `.env.local` or via your environment.

## Required Configuration

Chat UI connects to any OpenAI-compatible API endpoint:

```ini
OPENAI_BASE_URL=https://router.huggingface.co/v1
OPENAI_API_KEY=hf_************************
```

Models are automatically discovered from `${OPENAI_BASE_URL}/models`. No manual model configuration is required.

## Database

```ini
MONGODB_URL=mongodb://localhost:27017
MONGODB_DB_NAME=chat-ui
```

For development, `MONGODB_URL` is optional - Chat UI falls back to an embedded MongoDB that persists to `./db`.

## Model Overrides

To customize model behavior, use the `MODELS` environment variable (JSON5 format):

```ini
MODELS=`[
  {
    "id": "meta-llama/Llama-3.3-70B-Instruct",
    "name": "Llama 3.3 70B",
    "multimodal": false,
    "supportsTools": true
  }
]`
```

Override properties:

- `id` - Model identifier (must match an ID from the `/models` endpoint)
- `name` - Display name in the UI
- `multimodal` - Enable image uploads
- `supportsTools` - Enable MCP tool calling for models that don’t advertise tool support
- `parameters` - Override default parameters (temperature, max_tokens, etc.)

## Task Model

Set a specific model for internal tasks (title generation, etc.):

```ini
TASK_MODEL=meta-llama/Llama-3.1-8B-Instruct
```

If not set, the current conversation model is used.

## Voice Transcription

Enable voice input with Whisper:

```ini
TRANSCRIPTION_MODEL=openai/whisper-large-v3-turbo
TRANSCRIPTION_BASE_URL=https://router.huggingface.co/hf-inference/models
```

## Feature Flags

```ini
LLM_SUMMARIZATION=true          # Enable automatic conversation title generation
ENABLE_DATA_EXPORT=true         # Allow users to export their data
ALLOW_IFRAME=false              # Disallow embedding in iframes (set to true to allow)
```

### Feature Announcements

Display a dismissible toast on the home screen (no conversation open) to announce new features:

```ini
PUBLIC_FEATURE_ANNOUNCEMENTS=[{"title":"Introducing Artifacts","description":"Ask for an app, doc or diagram and watch it render live in a side panel.","link":"https://huggingface.co/blog","maxDate":"2026-12-31"}]
```

The value is a JSON5 array of announcement objects. Each object supports:

- `title` - Short heading shown in the toast
- `description` - One-sentence body text
- `link` _(optional)_ - URL the toast links to
- `maxDate` _(optional)_ - ISO date after which the announcement is hidden (a date-only value like `"2026-12-31"` is inclusive — hides at end of that day UTC)

The last entry whose `maxDate` has not yet passed is shown. Leave the variable empty (default) to show no announcement.

## User Authentication

Use OpenID Connect for authentication:

```ini
OPENID_CLIENT_ID=your_client_id
OPENID_CLIENT_SECRET=your_client_secret
OPENID_SCOPES="openid profile"
```

See [OpenID configuration](./open-id) for details.

### Requiring login on all routes

By default, unauthenticated users can access the home page and shared conversations without logging in. Set `AUTOMATIC_LOGIN=true` to redirect every unauthenticated request to the OAuth flow immediately:

```ini
AUTOMATIC_LOGIN=false   # default; set to true to require login on all routes
```

### Using the logged-in user's token for inference

By default, Chat UI uses `OPENAI_API_KEY` for all inference calls. Set `USE_USER_TOKEN=true` to forward the OAuth access token of the logged-in user to the inference endpoint instead. This is useful when the provider bills per-user or enforces per-user rate limits.

```ini
USE_USER_TOKEN=false   # default; set to true to use the user's OAuth token for inference
```

Requires a working OpenID Connect setup so that user tokens are available.

### Coupling sessions to an external cookie

If Chat UI is deployed on a sub-path of a domain that also sets its own auth cookie, you can tie Chat UI sessions to that cookie so that sessions are invalidated whenever the external auth state changes:

```ini
COUPLE_SESSION_WITH_COOKIE_NAME=my-auth-cookie
```

When set, Chat UI hashes the named cookie's value and stores it with each session. If the cookie value changes (e.g. the user logs out of the parent app), the Chat UI session is automatically destroyed. Leave empty (default) to disable this behaviour.

## Environment Variable Reference

See the [`.env` file](https://github.com/huggingface/chat-ui/blob/main/.env) for the complete list of available options.
