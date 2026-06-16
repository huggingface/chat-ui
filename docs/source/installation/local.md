# Running Locally

> [!IMPORTANT]
> Always create a `.env.local` file for your own configuration. **Never edit `.env` directly** — it is the default template checked into the repository and will be overwritten when you pull updates. Copy it as a starting point: `cp .env .env.local`

## Quick Start

1. Create `.env.local` with your API credentials:

```ini
OPENAI_BASE_URL=https://router.huggingface.co/v1
OPENAI_API_KEY=hf_your_token_here
# MONGODB_URL is optional for local dev — omit it to use the embedded in-memory DB
# that persists chat history to the ./db folder automatically
```

2. Install and run:

```bash
npm install
npm run dev -- --open
```

That's it! Chat UI will discover available models automatically from your endpoint.

## Common Setup Patterns

### Pattern 1: Hugging Face router (no MongoDB needed)

The fastest setup: uses the HF inference router and the embedded in-memory database.

```ini
# .env.local
OPENAI_BASE_URL=https://router.huggingface.co/v1
OPENAI_API_KEY=hf_your_token_here
```

Get your token at [hf.co/settings/tokens](https://huggingface.co/settings/tokens). Chat history persists to `./db` between restarts.

### Pattern 2: Local Ollama instance

First start Ollama (`ollama serve` runs on port 11434 by default), then:

```ini
# .env.local
OPENAI_BASE_URL=http://127.0.0.1:11434/v1
OPENAI_API_KEY=ollama
```

### Pattern 3: Customising models with the `MODELS` variable

The `MODELS` variable uses **JSON5 syntax wrapped in backticks**. The backticks are required — they allow multiline values in `.env` files. A missing backtick is the most common cause of a blank model list.

```ini
# .env.local
OPENAI_BASE_URL=https://router.huggingface.co/v1
OPENAI_API_KEY=hf_your_token_here
MODELS=`[
  {
    "id": "meta-llama/Llama-3.3-70B-Instruct",
    "name": "Llama 3.3 70B",
    "multimodal": false,
    "supportsTools": true
  }
]`
```

> [!NOTE]
> The opening backtick goes directly after `MODELS=` on the same line. The closing backtick goes on its own line after the `]`. Both are part of the value syntax, not shell syntax.

## Configuration

Chat UI connects to any OpenAI-compatible API. Set `OPENAI_BASE_URL` to your provider:

| Provider     | `OPENAI_BASE_URL`                  |
| ------------ | ---------------------------------- |
| Hugging Face | `https://router.huggingface.co/v1` |
| Ollama       | `http://127.0.0.1:11434/v1`        |
| llama.cpp    | `http://127.0.0.1:8080/v1`         |
| OpenRouter   | `https://openrouter.ai/api/v1`     |

See the [configuration overview](../configuration/overview) for all available options.

## Database

For **development**, MongoDB is optional. When `MONGODB_URL` is not set, Chat UI uses an embedded MongoDB server that persists data to the `./db` folder.

For **production**, you should use a dedicated MongoDB instance:

### Option 1: Local MongoDB (Docker)

```bash
docker run -d -p 27017:27017 -v mongo-chat-ui:/data --name mongo-chat-ui mongo:latest
```

Then set `MONGODB_URL=mongodb://localhost:27017` in `.env.local`.

### Option 2: MongoDB Atlas (Managed)

Use [MongoDB Atlas free tier](https://www.mongodb.com/pricing) for a managed database. Copy the connection string to `MONGODB_URL`.

## Running in Production

For production deployments:

```bash
npm install
npm run build
npm run preview
```

The server listens on `http://localhost:4173` by default.
