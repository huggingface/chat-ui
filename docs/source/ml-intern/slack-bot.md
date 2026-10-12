# ML Intern in Slack

The optional Slack bot runs inside the Chat UI server. Mention **@ML Intern** in a thread, or send it a direct message. For example:

> @ML Intern take the model discussed here and create a Gradio Space for it.

The bot reads that thread, then runs the same ML Intern harness used by HuggingChat. It posts a progress message, asks questions through an **Answer questions** button, and returns results in the thread. Forms support multiple choices and a typed **Other** answer. Only the person who started a thread's task can control it or answer its questions. In channels, follow-up requests need another mention; in DMs they do not.

Each thread has its own persistent conversation, scripts, compute budget and service registry. MongoDB keeps this state across restarts. A worker lease prevents multiple Chat UI replicas from consuming the same Slack workspace at once. Questions and timed waits resume through the existing server sweepers. Interrupted submissions are not automatically replayed: use **Resume** to continue a failed run. **Stop assistant** stops the agent, including a parked wait; it does not cancel Jobs already launched on the Hub.

This takes the thread/session and Socket Mode approach described in [Moon Bot](https://huggingface.co/blog/huggingface/moon-bot), while reusing ML Intern's MongoDB state and tool harness instead of creating a separate Pi agent. **Download trace** uploads the conversation as JSONL to the original Slack thread. Long answers are split into messages; no public conversation share is created.

## Install in a workspace

1. Create a Slack app **from a manifest**, using [`integrations/slack/manifest.json`](https://github.com/huggingface/chat-ui/blob/main/integrations/slack/manifest.json).
2. Install it in the workspace and copy its bot token (`xoxb-…`).
3. Under **Basic Information → App-Level Tokens**, generate a token with `connections:write` (`xapp-…`). The manifest enables Socket Mode and interactivity, so no public HTTP callback is needed.
4. Obtain the workspace ID (`T…`) and invite the bot to the channels where it should work.
5. Configure the server with the secrets below. Do not commit tokens or send them in a Slack message.

```env
ML_ASSISTANT_MODE=true
USE_USER_TOKEN=true
MCP_FORWARD_HF_USER_TOKEN=true

SLACK_ML_ENABLED=true
SLACK_ML_TEAM_ID=T_YOUR_WORKSPACE_ID
SLACK_ML_BOT_TOKEN=xoxb-your-bot-token
SLACK_ML_APP_TOKEN=xapp-your-app-token
SLACK_ML_HF_TOKEN=hf_your_shared_token
SLACK_ML_BUDGET_USD=0

# Optional: restrict the bot to these channel IDs (also restricts DMs)
SLACK_ML_ALLOWED_CHANNELS=
# Optional: default destination for repos, Spaces, datasets and Trackio dashboards.
# Empty uses the token owner; explicit user destinations override this default.
SLACK_ML_PUBLISH_NAMESPACE=ML-Intern-lab
# Optional: choose the compute payer independently of the publishing destination.
SLACK_ML_BILLING_ORGANIZATION=
SLACK_ML_BILLING_RESOURCE_GROUP=
```

Use the actual workspace ID with no underscore. Configure `OPENAI_BASE_URL`, `OPENAI_API_KEY` and `ML_ASSISTANT_MODELS` as described in [local development](./local-development.md). The HF token needs inference access and permission to use the Hub MCP tools, create Jobs, and write the repositories/Spaces the bot will create. Inference, nested agent calls, Hub tools and background continuations use the configured shared token. The startup model catalog still uses the normal `OPENAI_API_KEY` configuration.

Run `npm run dev`, or build with `npm run build` and start the Node deployment normally. `ML_ASSISTANT_MODE` must be enabled **when building**. Use persistent MongoDB or the bucket-backed Space deployment below. Enable the normal ML service poller, service events and parked/answered-question sweepers. The Slack integration is disabled by default and adds no inbound endpoint.

For Hugging Face's internal phase, provision one shared service-account HF token as `SLACK_ML_HF_TOKEN`. A dedicated bot deployment is convenient; when sharing a deployment, note that `USE_USER_TOKEN=true` also applies to browser chats. A different operator-pinned Hub MCP token is rejected at startup to prevent compute being charged to the wrong identity.

## Budget and access

The initial budget applies per Slack thread and defaults to **$0**. If compute is needed, ML Intern can propose a budget option in a question. Selecting that option updates the existing server-enforced ledger before the run resumes. Inference charges are separate. Configure a nonzero default only if everyone allowed to invoke the bot may spend it.

The bot accepts only workspace members, excluding guests, bots, deleted users and external Slack Connect channels. The optional channel allowlist is a further restriction. It reads up to 200 messages from the invoking thread, with a 24,000-character context bound. It does not search other channels, download Slack attachments or read linked Slack threads. If context is missing, provide the model URL or ID explicitly. Slack context and generated artifacts may be sent to the model provider and Hugging Face tools as part of the requested task.

The Slack app needs the history/read scopes in the manifest to retrieve channel or DM threads, `users:read` to check membership, `chat:write` for replies/forms, and `files:write` for requested traces. See Slack's [Socket Mode guide](https://docs.slack.dev/apis/events-api/using-socket-mode/) and [thread history API](https://docs.slack.dev/reference/methods/conversations.replies/).

## Other companies and phase two

This version supports **one workspace per deployment**. Another company can create the same app from the manifest, run its own instance, and supply its own Slack and HF tokens. Secrets are resolved from server configuration when a run resumes, rather than copied into conversation history or persisted as bot session tokens. Restart the server after rotating credentials.

A hosted, multi-workspace **Add to Slack** service is a separate deployment phase. It needs Slack OAuth installation storage, encrypted per-workspace HF credentials, tenant-scoped billing and model catalogs, and a web onboarding flow. The current configuration must not be reused as a multi-tenant credential store. Socket Mode apps also cannot currently be listed in Slack's public Marketplace; choose HTTP events if Marketplace distribution is required. Commercially distributed apps may have different thread-history rate limits than internal apps.

## Verification

```bash
npx vitest run --project=server src/lib/server/slack
npx vitest run --project=server src/lib/server/generation/__tests__/askResume.spec.ts src/lib/server/generation/parkedSweeper.spec.ts
npm run check
```

The tests use mocked Slack/model services and an isolated MongoDB. They do not send Slack messages or launch paid compute. A live smoke test still requires an installed Slack app and valid HF credentials: mention the bot in a test thread, give it a model link, answer a clarification, approve a small budget if needed, and verify the returned Space and trace.

## Deploy on Hugging Face Spaces

Use a private Docker Space with `integrations/slack/space/Dockerfile` as its root
Dockerfile and `integrations/slack/space/README.md` as its root README. The upload
helper runs from the repository root:

```bash
node integrations/slack/space/upload.mjs your-account/ml-intern-slackbot-server
```

It uploads tracked source files in batches, excludes local env files,
and checks that configured credentials are not included. It reads the upload token
from the ignored `.env.local`. Configure `cpu-upgrade` with sleep time `-1` and one
replica. Store Slack/HF tokens as Space secrets and set `SLACK_ML_STATE_BUCKET`
to a private HF Bucket (for example `your-account/ml-intern-slackbot-state`). The
Space starts MongoDB on loopback and restores `latest.json.gz` from that bucket
before starting the bot. No external MongoDB account is needed. Live database
files remain on local disk; the bucket contains compressed Extended JSON snapshots.

Seed the bucket from the existing Slack collections before the first startup,
using `snapshot`/`writeBackup` in `integrations/slack/space/state.mjs`. Migrate only
Slack conversations, synthetic users, and related state, excluding browser sessions
and OAuth tokens. Restore fails closed if the snapshot is missing or invalid.
Snapshots briefly lock writes while reading all collections, then unlock before
compression/upload. BSON IDs, dates, and indexes survive restore.

Backups run every 30 seconds after the preceding upload completes and on graceful
shutdown. An abrupt crash can lose changes since the last completed backup. Three
consecutive backup failures stop the worker. This is a single-replica pilot, not a
lossless database service. Pause the Space before deploying/restarting it and wait
for shutdown to finish; never run two replicas with independent local databases
against this bucket. A MongoDB lease cannot coordinate independent databases.

Set `ENABLE_CONFIG_MANAGER=false` so Space environment variables are authoritative,
`MONGODB_DB_NAME` to a dedicated database, and the ML Intern variables listed above.
The Dockerfile enables ML Intern at build time. Keep `SLACK_ML_ENABLED=false` until
state has been migrated and the local worker stopped, then enable the Space worker.
Do not connect workers using different databases to the same Slack app concurrently.
The shared-database lease protects replicas; independent databases cannot coordinate it.

Verify two overlapping threads, a question/answer resume, and a Space restart before
retiring the local deployment. Each thread has its own conversation and budget;
owner checks prevent a second user controlling someone else's thread. Four active
turns can execute concurrently, with additional work queued. Waiting questions and
parked jobs do not occupy an active initial-turn slot.
