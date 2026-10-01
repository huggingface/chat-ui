# Running Chat UI with ML Intern locally

This guide is for developers who want to run ML Intern on their own machine, try changes to it, or deploy it in their own Chat UI instance. If you just want to use ML Intern, see [Getting started with ML Intern](./getting-started.md).

ML Intern is a mode built into Chat UI. When it's on, a conversation:

- runs on a fixed set of tool-capable models
- connects to the Hugging Face MCP server with the Hub's `intern` tool set
- gets extra built-in tools: planning, research, versioned script files, sandboxes, Trackio dashboards, and waiting on Jobs
- carries a compute budget that the server enforces on every Job and sandbox it launches

## Prerequisites

- Node.js 20 or later, and a clone of [huggingface/chat-ui](https://github.com/huggingface/chat-ui) with `npm install` run.
- A Hugging Face account with credits. The ML Intern conversations you run locally launch real Jobs and sandboxes on your account.
- A [Hugging Face access token](https://huggingface.co/settings/tokens) with permission to call Inference Providers. Chat UI uses it to talk to the models.
- A Hugging Face OAuth app (set up in [Step 1](#step-1-create-a-hugging-face-oauth-app)), so you can sign in. ML Intern runs its Hub tools with the signed-in user's token. Without sign-in, those tools run anonymously and can't start Jobs or write to the Hub.

MongoDB is optional. If `MONGODB_URL` isn't set, Chat UI starts an in-memory database and persists it to `./db`.

## Step 1: Create a Hugging Face OAuth app

1. Go to [huggingface.co/settings/applications/new](https://huggingface.co/settings/applications/new).
2. Set the redirect URI to `http://localhost:5173/login/callback`.
3. Allow these scopes:
   - `openid`, `profile`
   - `inference-api`
   - `read-mcp`
   - `read-billing`
   - `jobs`
   - `contribute-repos` (optional)

   `jobs` is required: without it, every Job submission returns 403. `contribute-repos` lets ML Intern deploy to Spaces, and it can only update the Spaces it created. `read-billing` lists the organizations and resource groups a user can bill to.

4. Note the app's client ID and secret.

## Step 2: Configure `.env.local`

Create `.env.local` in the repository root. The defaults and full documentation for every variable are in `.env`.

```env
# Models, through the Hugging Face router
OPENAI_BASE_URL=https://router.huggingface.co/v1
OPENAI_API_KEY=hf_***

# Sign in with Hugging Face (Step 1)
OPENID_CLIENT_ID=<client id>
OPENID_CLIENT_SECRET=<client secret>
OPENID_SCOPES="openid profile inference-api read-mcp read-billing contribute-repos jobs"
# Send the signed-in user's token to the Hugging Face MCP server
MCP_FORWARD_HF_USER_TOKEN=true

# Compile ML Intern in
ML_ASSISTANT_MODE=true
# Models ML Intern may run on; the first entry is the default
ML_ASSISTANT_MODELS=[{"id":"zai-org/GLM-5.3-Flash","provider":"together"},{"id":"moonshotai/Kimi-K3","provider":"baseten"}]

# Optional: HuggingChat-only UI, including the billing picker in Settings
PUBLIC_APP_ASSETS=huggingchat
# Optional: a GitHub token with no scopes, to raise the rate limit of the
# tools that read example scripts from public repositories
GITHUB_TOKEN=
```

Notes:

- **`ML_ASSISTANT_MODE` is a build-time flag.** Vite compiles it into the bundle, so a deployed build either ships ML Intern or can't turn it on. After changing it, restart the dev server.
- **`ML_ASSISTANT_MODELS` is a JSON5 array.** Each entry needs an `id` that exists in the router's model catalog and a `provider`; the router alias isn't accepted. An optional `parameters` object merges over the catalog entry's.
  - Against the Hugging Face router, conversations are pinned to that provider, whatever the user's own provider preference is.
  - Against other OpenAI-compatible endpoints, the pin isn't applied.
  - If the list is empty, the ML Intern switch is hidden and the mode refuses to start a conversation.
- **Billing.** Without `PUBLIC_APP_ASSETS=huggingchat`, there's no billing picker, and Jobs bill to the signed-in user.

## Step 3: Run it

```bash
npm run dev
```

Open [http://localhost:5173/?mode=ml-intern](http://localhost:5173/?mode=ml-intern) and sign in. The `?mode=ml-intern` parameter turns the mode on (you can also use the switch under the message box), and it stays in the URL so a reload keeps you in the mode.

Every ML Intern conversation starts with a compute budget of **$0**, so no Jobs or sandboxes can launch until you set one. Set it from the status bar above the message box, and keep it small while you experiment.

## Choosing models

ML Intern runs long tool-calling loops, often with hundreds of thousands of tokens of context. Not every model or provider handles that reliably, which is why each entry in `ML_ASSISTANT_MODELS` pins a provider. To check a model and provider before adding them, run the probe script. It replays an ML Intern-style history at large context sizes and grades how the stream ends:

```bash
npm run probe-model -- --model zai-org/GLM-5.3-Flash --provider together
npm run probe-model -- --model moonshotai/Kimi-K3 --suite quick
```

The header of `scripts/probe-model.ts` documents the suites, sizes and verdicts.

## Feature switches

Several parts of ML Intern have kill switches. Each is on unless set to `false`, and each is documented in `.env`:

| Variable                                | Controls                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ML_ASSISTANT_VIRTUAL_FILES`            | Versioned script files (`write_file`, `edit_file`, `read_file`) that Jobs and sandboxes reference as `v-file://<name>` |
| `ML_ASSISTANT_STATE_BLOCK`              | The session state (running Jobs, sandboxes, repos, files) appended to each turn                                        |
| `ML_ASSISTANT_SERVICE_POLLER`           | The background poller that tracks Job and sandbox status and settles the budget when they end                          |
| `ML_ASSISTANT_SERVICE_POLL_INTERVAL_MS` | How often the poller looks for services that are due (default 5000)                                                    |
| `ML_ASSISTANT_SERVICE_EVENTS`           | Waking a waiting turn when a Job or sandbox ends (needs the poller)                                                    |
| `ML_ASSISTANT_PUSH_CHECKS`              | Checking which repos a finished Job pushed to (needs the poller)                                                       |
| `ML_ASSISTANT_JOB_LABELS`               | Naming and labelling ML Intern Jobs, and recovering submissions whose reply was lost                                   |

## Where the code lives

| Area                                                                      | Location                                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Build flag                                                                | `src/lib/utils/mlAssistantFlag.ts`, `vite.config.ts`                                                                                |
| Mode, model set and Hub MCP preset                                        | `src/lib/server/mlAssistant.ts`, `src/lib/server/mlAssistantModels.ts`                                                              |
| System prompt                                                             | `src/lib/server/mlAssistantPrompt.ts`                                                                                               |
| Built-in tools (plan, research, sandbox, wait, files, Trackio, questions) | `src/lib/server/textGeneration/builtinTools/`                                                                                       |
| Tool loop and MCP                                                         | `src/lib/server/textGeneration/mcp/`                                                                                                |
| Jobs, sandboxes and repos the conversation created                        | `src/lib/server/mlRegistry/`                                                                                                        |
| Versioned script files                                                    | `src/lib/server/mlFiles/`                                                                                                           |
| Client state                                                              | `src/lib/stores/mlAssistant.svelte.ts`, `src/lib/stores/mlRegistry.svelte.ts`                                                       |
| UI: switch, status bar, onboarding, side panel                            | `src/lib/components/chat/MlInternPill.svelte`, `MlAssistantStrip.svelte`, `MlInternOnboardingModal.svelte`, `MlRegistryPane.svelte` |
| Copy, example prompts and preset constants                                | `src/lib/constants/mlAssistant.ts`                                                                                                  |

## Testing

Run the unit tests for the parts you changed, for example:

```bash
npx vitest run src/lib/server/mlRegistry
npx vitest run src/lib/server/textGeneration/builtinTools
```

`npm run test` runs everything, and `npm run test:e2e` runs the Playwright suite. The e2e suite uses a mock LLM and mock MCP servers, so it needs no keys and launches nothing on Hugging Face. It needs Node.js 22.6 or later.

## Troubleshooting

- **No ML Intern switch.** Check that `ML_ASSISTANT_MODE=true` and `ML_ASSISTANT_MODELS` is set, and restart the dev server. The switch only shows in an empty conversation.
- **Jobs fail with 403.** The OAuth app or `OPENID_SCOPES` is missing `jobs`. Sign out and back in after adding it, so your token carries the new scope.
- **ML Intern can't use Hub tools, or acts anonymously.** Make sure you're signed in and `MCP_FORWARD_HF_USER_TOKEN=true` is set. Also check which tools are enabled in your [Hugging Face MCP settings](https://huggingface.co/settings/mcp).
- **Every launch is refused.** The conversation's compute budget is still $0. Set it from the status bar.
- **Sign-in redirects fail.** The OAuth app's redirect URI must match `http://localhost:5173/login/callback` exactly, including the port.
