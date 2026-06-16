# Running on Docker

Pre-built Docker images are available:

- **`ghcr.io/huggingface/chat-ui-db`** - Includes MongoDB (recommended for quick setup)
- **`ghcr.io/huggingface/chat-ui`** - Requires external MongoDB

## Quick Start (with bundled MongoDB)

```bash
docker run -p 3000:3000 \
  -e OPENAI_BASE_URL=https://router.huggingface.co/v1 \
  -e OPENAI_API_KEY=hf_*** \
  -v chat-ui-data:/data \
  ghcr.io/huggingface/chat-ui-db
```

## With External MongoDB

If you have an existing MongoDB instance:

```bash
docker run -p 3000:3000 \
  -e OPENAI_BASE_URL=https://router.huggingface.co/v1 \
  -e OPENAI_API_KEY=hf_*** \
  -e MONGODB_URL=mongodb://host.docker.internal:27017 \
  ghcr.io/huggingface/chat-ui
```

Use `host.docker.internal` to reach MongoDB running on your host machine, or provide your MongoDB Atlas connection string.

## With a Local Ollama Instance

To connect Docker-hosted Chat UI to Ollama running on your host machine, use `host.docker.internal` instead of `localhost` (Linux users: add `--add-host=host.docker.internal:host-gateway`):

```bash
docker run -p 3000:3000 \
  -e OPENAI_BASE_URL=http://host.docker.internal:11434/v1 \
  -e OPENAI_API_KEY=ollama \
  -v chat-ui-data:/data \
  ghcr.io/huggingface/chat-ui-db
```

On Linux, append `--add-host=host.docker.internal:host-gateway` to the command so Docker can resolve the hostname.

## Using an Environment File

For more configuration options, use `--env-file` to avoid leaking secrets in shell history:

```bash
docker run -p 3000:3000 \
  --env-file .env.local \
  -v chat-ui-data:/data \
  ghcr.io/huggingface/chat-ui-db
```

> [!TIP]
> Use `--env-file .env.local` rather than multiple `-e` flags. This keeps your tokens out of shell history and makes it easy to reuse the same configuration file you use for local development.

See the [configuration overview](../configuration/overview) for all available environment variables.
