# Chat UI

![Chat UI repository thumbnail](https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chat-ui/chat-ui-2026.png)

A chat interface for LLMs. It is a SvelteKit app and it powers the [HuggingChat app on hf.co/chat](https://huggingface.co/chat).

0. [Quickstart](#quickstart)
1. [Database Options](#database-options)
2. [Launch](#launch)
3. [Optional Docker Image](#optional-docker-image)
4. [Extra parameters](#extra-parameters)
5. [Building](#building)

> [!NOTE]
> Chat UI only supports OpenAI-compatible APIs via `OPENAI_BASE_URL` and the `/models` endpoint. Provider-specific integrations (legacy `MODELS` env var, GGUF discovery, embeddings, web-search helpers, etc.) are removed, but any service that speaks the OpenAI protocol (llama.cpp server, Ollama, OpenRouter, etc. will work by default).

> [!NOTE]
> The old version is still available on the [legacy branch](https://github.com/huggingface/chat-ui/tree/legacy)

## Quickstart

Chat UI speaks to OpenAI-compatible APIs only. The fastest way to get running is with the Hugging Face Inference Providers router plus your personal Hugging Face access token.

**Step 1 – Create `.env.local`:**

```env
OPENAI_BASE_URL=https://router.huggingface.co/v1
OPENAI_API_KEY=hf_************************
```

`OPENAI_API_KEY` can come from any OpenAI-compatible endpoint you plan to call. Pick the combo that matches your setup and drop the values into `.env.local`:

| Provider                                      | Example `OPENAI_BASE_URL`          | Example key env                                                         |
| --------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Hugging Face Inference Providers router       | `https://router.huggingface.co/v1` | `OPENAI_API_KEY=hf_xxx` (or `HF_TOKEN` legacy alias)                    |
| llama.cpp server (`llama.cpp --server --api`) | `http://127.0.0.1:8080/v1`         | `OPENAI_API_KEY=sk-local-demo` (any string works; llama.cpp ignores it) |
| Ollama (with OpenAI-compatible bridge)        | `http://127.0.0.1:11434/v1`        | `OPENAI_API_KEY=ollama`                                                 |
| OpenRouter                                    | `https://openrouter.ai/api/v1`     | `OPENAI_API_KEY=sk-or-v1-...`                                           |
| Poe                                           | `https://api.poe.com/v1`           | `OPENAI_API_KEY=pk_...`                                                 |

Check the root [`.env` template](./.env) for the full list of optional variables you can override.

**Step 2 – Install and launch the dev server:**

```bash
git clone https://github.com/huggingface/chat-ui
cd chat-ui
npm install
npm run dev -- --open
```

You now have Chat UI running locally. Open the browser and start chatting.

## Database Options

Chat history, users, settings, files, and stats all live in MongoDB. You can point Chat UI at any MongoDB 6/7 deployment.

> [!TIP]
> For quick local development, you can skip this section. When `MONGODB_URL` is not set, Chat UI falls back to an embedded MongoDB that persists to `./db`.

### MongoDB Atlas (managed)

1. Create a free cluster at [mongodb.com](https://www.mongodb.com/pricing).
2. Add your IP (or `0.0.0.0/0` for development) to the network access list.
3. Create a database user and copy the connection string.
4. Paste that string into `MONGODB_URL` in `.env.local`. Keep the default `MONGODB_DB_NAME=chat-ui` or change it per environment.

Atlas keeps MongoDB off your laptop, which is ideal for teams or cloud deployments.

### Local MongoDB (container)

If you prefer to run MongoDB in a container:

```bash
docker run -d -p 27017:27017 --name mongo-chatui mongo:latest
```

Then set `MONGODB_URL=mongodb://localhost:27017` in `.env.local`.

## Launch

After configuring your environment variables, start Chat UI with:

```bash
npm install
npm run dev
```

The dev server listens on `http://localhost:5173` by default. Use `npm run build` / `npm run preview` for production builds.

## Optional Docker Image

The `chat-ui-db` image bundles MongoDB inside the container:

```bash
docker run \
  -p 3000:3000 \
  -e OPENAI_BASE_URL=https://router.huggingface.co/v1 \
  -e OPENAI_API_KEY=hf_*** \
  -v chat-ui-data:/data \
  ghcr.io/huggingface/chat-ui-db:latest
```

All environment variables accepted in `.env.local` can be provided as `-e` flags.

## Extra parameters

### Theming

You can use a few environment variables to customize the look and feel of chat-ui. These are by default:

```env
PUBLIC_APP_NAME=ChatUI
PUBLIC_APP_ASSETS=chatui
PUBLIC_APP_DESCRIPTION="Making the community's best AI chat models available to everyone."
PUBLIC_APP_DATA_SHARING=
```

- `PUBLIC_APP_NAME` The name used as a title throughout the app.
- `PUBLIC_APP_ASSETS` Is used to find logos & favicons in `static/$PUBLIC_APP_ASSETS`, current options are `chatui` and `huggingchat`.
- `PUBLIC_APP_DATA_SHARING` Can be set to 1 to add a toggle in the user settings that lets your users opt-in to data sharing with models creator.

### Models

Models are discovered from `${OPENAI_BASE_URL}/models`, and you can optionally override their metadata via the `MODELS` env var (JSON5). Legacy provider‑specific integrations and GGUF discovery are removed. Authorization uses `OPENAI_API_KEY` (preferred). `HF_TOKEN` remains a legacy alias.

### LLM Router (Optional)

Chat UI can perform server-side smart routing using [katanemo/Arch-Router-1.5B](https://huggingface.co/katanemo/Arch-Router-1.5B) as the routing model without running a separate router service. The UI exposes a virtual model alias called "Omni" (configurable) that, when selected, chooses the best route/model for each message.

- Provide a routes policy JSON via `LLM_ROUTER_ROUTES_PATH`. No sample file ships with this branch, so you must point the variable to a JSON array you create yourself (for example, commit one in your project like `config/routes.chat.json`). Each route entry needs `name`, `description`, `primary_model`, and optional `fallback_models`.
- Configure the Arch router selection endpoint with `LLM_ROUTER_ARCH_BASE_URL` (OpenAI-compatible `/chat/completions`) and `LLM_ROUTER_ARCH_MODEL` (e.g. `router/omni`). The Arch call reuses `OPENAI_API_KEY` for auth.
- Map `other` to a concrete route via `LLM_ROUTER_OTHER_ROUTE` (default: `casual_conversation`). If Arch selection fails, calls fall back to `LLM_ROUTER_FALLBACK_MODEL`.
- Selection timeout can be tuned via `LLM_ROUTER_ARCH_TIMEOUT_MS` (default 10000).
- Omni alias configuration: `PUBLIC_LLM_ROUTER_ALIAS_ID` (default `omni`), `PUBLIC_LLM_ROUTER_DISPLAY_NAME` (default `Omni`), and optional `PUBLIC_LLM_ROUTER_LOGO_URL`.

When you select Omni in the UI, Chat UI will:

- Call the Arch endpoint once (non-streaming) to pick the best route for the last turns.
- Emit RouterMetadata immediately (route and actual model used) so the UI can display it.
- Stream from the selected model via your configured `OPENAI_BASE_URL`. On errors, it tries route fallbacks.

Tool and multimodal shortcuts:

- Multimodal: If `LLM_ROUTER_ENABLE_MULTIMODAL=true` and the user sends an image, the router bypasses Arch and uses the model specified in `LLM_ROUTER_MULTIMODAL_MODEL`. Route name: `multimodal`.
- Tools: If `LLM_ROUTER_ENABLE_TOOLS=true` and the user has at least one MCP server enabled, the router bypasses Arch and uses `LLM_ROUTER_TOOLS_MODEL`. If that model is missing or misconfigured, it falls back to Arch routing. Route name: `agentic`.

### MCP Tools (Optional)

Chat UI can call tools exposed by Model Context Protocol (MCP) servers and feed results back to the model using OpenAI function calling. You can preconfigure trusted servers via env, let users add their own, and optionally have the Omni router auto‑select a tools‑capable model.

Configure servers (base list for all users):

```env
# JSON array of servers: name, url, optional headers
MCP_SERVERS=[
  {"name": "Web Search (Exa)", "url": "https://mcp.exa.ai/mcp"},
  {"name": "Hugging Face MCP Login", "url": "https://hf.co/mcp?login"}
]

# Forward the signed-in user's Hugging Face token to the official HF MCP login endpoint
# when no Authorization header is set on that server entry.
MCP_FORWARD_HF_USER_TOKEN=true
```

Enable router tool path (Omni):

- Set `LLM_ROUTER_ENABLE_TOOLS=true` and choose a tools‑capable target with `LLM_ROUTER_TOOLS_MODEL=<model id or name>`.
- The target must support OpenAI tools/function calling. Chat UI surfaces a “tools” badge on models that advertise this; you can also force‑enable it per‑model in settings (see below).

Use tools in the UI:

- Open “MCP Servers” from the top‑right menu or from the `+` menu in the chat input to add servers, toggle them on, and run Health Check. The server card lists available tools.
- When a model calls a tool, the message shows a compact “tool” block with parameters, a progress bar while running, and the result (or error). Results are also provided back to the model for follow‑up.

Per‑model overrides:

- In Settings → Model, you can toggle “Tool calling (functions)” and “Multimodal input” per model. These overrides apply even if the provider metadata doesn’t advertise the capability.

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://kit.svelte.dev/docs/adapters) for your target environment.
