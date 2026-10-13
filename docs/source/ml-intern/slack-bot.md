# ML Intern in Slack

The optional Slack bot runs inside the Chat UI server. Mention **@ML Intern** in a thread, or send it a direct message. For example:

> @ML Intern take the model discussed here and create a Gradio Space for it.

The bot reads that thread, then runs the same ML Intern harness used by HuggingChat. It immediately reacts to accepted requests with 👀 before inference, then updates a thread message with the current activity (such as researching sources), completed research lookups, and elapsed time in 10-second increments. During scheduled waits it shows the next check countdown; successful Space creation exposes a link immediately, labeled as still in setup. The compact plan shows the current step and completed-step count. Progress updates show no private model reasoning or raw tool arguments. It shows numbered questions (1, 2, 3) and lettered options (A, B, C) in separate sections without repeating the question below the choices. A single-choice question with up to five options has inline buttons with an explicit confirmation, including the exact amount for budget grants. Forms with two to five single-choice questions and up to five options each also show inline choices. Selections refresh directly after each click and are saved as drafts; **Submit answers** appears after every question has a selection and confirms them together, including any budget amount. Changing a selection invalidates an older submit button. Longer or multi-select forms use the **Answer questions** modal. A divider separates the questions and controls from the compute summary. Inline choices omit that redundant button; an **Other answer** button remains when custom answers are allowed. New answers submitted through Slack are posted back to the thread with the original question and selected answer; previously answered private forms are not retroactively published. After answers are submitted, the original question card remains in place with its controls removed. Confirmed answers are posted next, and the assistant continues in a new message below them. Results also appear in the thread. Workspace members can mention the bot in an existing channel thread to participate in the same conversation. The original task owner remains the only person who can approve budgets, submit question forms, or stop or resume the task. Workspace members can use **Download trace** in a channel thread; the file is posted only to that original thread. DM traces remain private to the DM owner. Participants share that thread's existing approved budget; other threads and DMs remain separate sessions. In channels, follow-up requests need another mention; in DMs they do not.

Public run updates are retained in a separate, cumulative message in the Slack thread. Earlier results, links, and instructions remain readable as the compact status card changes or becomes a question or final response. Only public assistant text is shown, never private reasoning. Long updates continue in additional messages. Public commentary is published before the question it leads to. After an answer, only new commentary appears below it; earlier text is not replayed. Final results are posted as a new message after progress updates.

Each thread has its own persistent conversation, scripts, compute budget and service registry. MongoDB keeps this state across restarts. A worker lease prevents multiple Chat UI replicas from consuming the same Slack workspace at once. Questions and timed waits resume through the existing server sweepers. Interrupted submissions are not automatically replayed: use **Resume** to continue a failed run. **Stop assistant** stops the agent, including a parked wait; it does not cancel Jobs already launched on the Hub. The private stop confirmation appears inside that same Slack thread.

This takes the thread/session and Socket Mode approach described in [Moon Bot](https://huggingface.co/blog/huggingface/moon-bot), while reusing ML Intern's MongoDB state and tool harness instead of creating a separate Pi agent. **Download trace** uploads the conversation as JSONL to the original Slack thread. Long answers are split into messages; no public conversation share is created.

## Thread permissions

The **owner** is the person who first invoked ML Intern in that thread, which may be different from the person who posted the thread's first message.

| Action                                                       | Everyone in the channel | Owner only |
| ------------------------------------------------------------ | :---------------------: | :--------: |
| Mention ML Intern to ask questions or request follow-up work |            ✓            |            |
| View responses, progress, questions, and confirmed answers   |            ✓            |            |
| Download the thread's trace                                  |            ✓            |            |
| Request work using the thread's existing approved budget     |            ✓            |            |
| Set or change the compute budget                             |                         |     ✓      |
| Submit answers through question buttons or forms             |                         |     ✓      |
| Stop the assistant                                           |                         |     ✓      |
| Resume an interrupted or failed task                         |                         |     ✓      |

“Everyone” means eligible members of the same Slack workspace. Guests, bots, and external shared channels are excluded; the configured channel allowlist also applies. A trace download posts the file only to its original thread.

Each thread has its own conversation and budget. DMs are separate private sessions, with the person messaging the bot as owner. Follow-up requests in channels require another mention. If the current turn is still running or waiting for input, wait for it to finish or have the owner answer or stop it before sending another request.

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
SLACK_ML_TEAM_ID=T0123456789
SLACK_ML_BOT_TOKEN=xoxb-your-bot-token
SLACK_ML_APP_TOKEN=xapp-your-app-token
SLACK_ML_HF_TOKEN=hf_your_shared_token
SLACK_ML_BUDGET_USD=0

# Optional: restrict the bot to these channel IDs (also restricts DMs)
SLACK_ML_ALLOWED_CHANNELS=
# Optional: default destination for repos, Spaces, datasets and Trackio dashboards.
# Empty uses the token owner; explicit user destinations override this default.
SLACK_ML_PUBLISH_NAMESPACE=your-company-org
# Optional: choose the compute payer independently of the publishing destination.
SLACK_ML_BILLING_ORGANIZATION=
SLACK_ML_BILLING_RESOURCE_GROUP=
```

Use the actual workspace ID with no underscore. Configure `OPENAI_BASE_URL`, `OPENAI_API_KEY` and `ML_ASSISTANT_MODELS` as described in [local development](./local-development.md). The Slack-only deployment uses the shared HF token and does not require the browser OAuth app described in that guide. The HF token needs inference access and permission to use the Hub MCP tools, create Jobs, and write the repositories/Spaces the bot will create. Inference, nested agent calls, Hub tools and background continuations use the configured shared token. The startup model catalog still uses the normal `OPENAI_API_KEY` configuration.

Run `npm run dev`, or build with `npm run build` and start the Node deployment normally. `ML_ASSISTANT_MODE` must be enabled **when building**. Use persistent MongoDB or the bucket-backed Space deployment below. Enable the normal ML service poller, service events and parked/answered-question sweepers. The Slack integration is disabled by default and adds no inbound endpoint.

For Hugging Face's internal phase, provision one shared service-account HF token as `SLACK_ML_HF_TOKEN`. A dedicated bot deployment is convenient; when sharing a deployment, note that `USE_USER_TOKEN=true` also applies to browser chats. A different operator-pinned Hub MCP token is rejected at startup to prevent compute being charged to the wrong identity.

## Budget and access

The initial budget applies per Slack thread and defaults to **$0**. If compute is needed, ML Intern can propose a budget option in a question. Selecting that option updates the existing server-enforced ledger before the run resumes. Inference charges are separate. Configure a nonzero default only if everyone allowed to invoke the bot may spend it.

The bot accepts only workspace members, excluding guests, bots, deleted users and external Slack Connect channels. The optional channel allowlist is a further restriction. It reads up to 200 messages from the invoking thread, with a 24,000-character context bound. It does not search other channels, download Slack attachments or read linked Slack threads. If context is missing, provide the model URL or ID explicitly. Slack context and generated artifacts may be sent to the model provider and Hugging Face tools as part of the requested task.

For an existing installation, add the **reactions:write** bot scope under **OAuth & Permissions**, then reinstall the app to the workspace to enable the 👀 acknowledgement. Updating the manifest or server alone does not grant the installed token a new scope. If the reaction fails, the request still runs. No separate receipt message is posted.

The Slack app needs the history/read scopes in the manifest to retrieve channel or DM threads, `users:read` to check membership, `chat:write` for replies/forms, and `files:write` for requested traces. See Slack's [Socket Mode guide](https://docs.slack.dev/apis/events-api/using-socket-mode/) and [thread history API](https://docs.slack.dev/reference/methods/conversations.replies/).

## Company Slack with a Hugging Face organization

A company can run one dedicated deployment for its Slack workspace, with its own
HF credentials. Employees invoke the bot through Slack; they do not each connect
an HF account. Their threads have separate conversations and budgets, but all
requests use the deployment's shared HF credential and configured payer.

### Choose the credential and organization

Use an organization member's HF token with the required organization permissions.
Membership alone is insufficient: both the member's role and the token's scopes
must allow the requested operation. See [HF access tokens](https://huggingface.co/docs/hub/security-tokens).
HF also offers [organization-owned service accounts](https://huggingface.co/docs/hub/enterprise-service-accounts)
on Enterprise plans. Service-account credentials have not yet been verified
end-to-end with this bot; the tested path uses a member token with organization access.

The shared token needs Inference Providers access, access to the Hub MCP tools,
permission to run Jobs under the intended payer, and permission to create/write
repos and Spaces in the publishing organization. For the bucket-backed deployment,
it also needs read/write access to the state bucket. The upload helper uses that
same token to update the server Space. Check the organization's billing setup,
credits, and hardware quotas for the operations you intend to allow.

Replace `your-company-org` with the actual HF organization slug:

```env
SLACK_ML_PUBLISH_NAMESPACE=your-company-org
SLACK_ML_BILLING_ORGANIZATION=your-company-org
# Optional resource group for billing; requires the billing organization above.
SLACK_ML_BILLING_RESOURCE_GROUP=
SLACK_ML_STATE_BUCKET=your-company-org/ml-intern-slackbot-state
```

These settings serve different purposes:

| Setting                         | Purpose                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SLACK_ML_HF_TOKEN`             | Authenticates the bot's HF requests. It must have access to the organization.                                                                                          |
| `SLACK_ML_PUBLISH_NAMESPACE`    | Default destination for generated repos, Spaces, datasets and dashboards. Users can explicitly request a different destination if the token permits it.                |
| `SLACK_ML_BILLING_ORGANIZATION` | Selects the organization used for session billing. Leaving it empty uses the token owner's billing context. Publishing to an organization does not select it as payer. |
| `SLACK_ML_STATE_BUCKET`         | Stores backups of the bot's conversations and internal state; keep it private.                                                                                         |
| Server Space owner              | Owns and pays for the always-on bot server hardware, independently of each thread's compute budget.                                                                    |

This is shared service access, not per-employee HF authorization. Only enable
channels whose members may use the configured credential. The initial compute
budget is per thread, not a company-wide spending cap, and permitted invokers can
approve requested budget grants. Inference and server hosting are separate costs.

### Install the company's Slack app

Follow [Install in a workspace](#install-in-a-workspace) using the company's Slack
workspace. A workspace administrator may need to approve the app installation.
Use that installation's bot token, app-level token and workspace ID. Create a
private testing channel, invite the bot, and initially set
`SLACK_ML_ALLOWED_CHANNELS` to that channel's ID. Use a dedicated Space and bucket
for this workspace; do not share another company's deployment or credentials.

Continue with [Deploy on Hugging Face Spaces](#deploy-on-hugging-face-spaces).
The manual setup is supported today. A centrally hosted, self-service installation
flow is described under [Other companies and phase two](#other-companies-and-phase-two).

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

### 1. Prepare the checkout and Space

Use a checkout containing this integration and run `npm ci` from its root. Create
a **private Docker Space** under the company organization, for example
`your-company-org/ml-intern-slackbot-server`. Use one replica, upgraded CPU
hardware, and disable sleeping (sleep time `-1`). Keep the Space paused during
setup and upload; the helper uploads several commits and does not configure
hardware, secrets, or variables for you.

Create an ignored `.env.local` in the checkout with `SLACK_ML_HF_TOKEN` and
`SLACK_ML_STATE_BUCKET` from the company configuration above. The upload helper
reads its token from this file. Do not commit it. Creating a Space does not copy
your local environment into its settings.

### 2. Initialize state for a fresh installation

For a **new installation with no sessions to migrate**, run this command from
the checkout root after setting `.env.local`. It creates a new private bucket
and seeds an empty Slack thread collection in the snapshot format the server
expects. It refuses to proceed if the bucket already exists, so it cannot silently
replace an existing installation's sessions. This step requires permission to
create a bucket in the organization.

```bash
node --input-type=module <<'JS'
import { config } from "dotenv";
import { createRepo } from "@huggingface/hub";
import { BSON } from "mongodb";
import { gzipSync } from "node:zlib";
import { writeBackup } from "./integrations/slack/space/state.mjs";

config({ path: ".env.local", quiet: true });
const bucket = process.env.SLACK_ML_STATE_BUCKET;
const token = process.env.SLACK_ML_HF_TOKEN;
if (!bucket || !token) throw new Error("Set SLACK_ML_STATE_BUCKET and SLACK_ML_HF_TOKEN");
await createRepo({
  repo: { type: "bucket", name: bucket },
  visibility: "private",
  accessToken: token,
});
const bytes = gzipSync(BSON.EJSON.stringify({
  version: 1,
  createdAt: new Date(),
  collections: [{ name: "slack.threads", documents: [], indexes: [] }],
}, { relaxed: false }));
await writeBackup(bucket, token, bytes);
console.log("Created private bucket and initial state snapshot.");
JS
```

If upload fails after bucket creation, inspect the bucket before retrying. Do not
replace `latest.json.gz` if a bot has already used that bucket. Choose a new bucket
name for a clean retry. Startup deliberately fails when the snapshot is missing
or invalid; an empty bucket alone is not sufficient.

For an **existing installation**, skip the empty seed. Stop its worker and migrate
its existing Slack conversations and related state using `snapshot`/`writeBackup`
in `integrations/slack/space/state.mjs`. Include synthetic Slack users, thread/input/
delivery records, budgets, questions, waits, files and registry data, while excluding
unrelated browser sessions and OAuth credentials. This is a programmatic migration,
not an automatic import wizard; verify a restore before retiring the original database.

### 3. Configure Space settings

In the Space's **Settings**, add these **secrets**:

| Secret               | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| `SLACK_ML_HF_TOKEN`  | The shared HF token with organization access.          |
| `OPENAI_API_KEY`     | The same HF token, used for the startup model catalog. |
| `SLACK_ML_BOT_TOKEN` | The company's installed Slack bot token (`xoxb-…`).    |
| `SLACK_ML_APP_TOKEN` | The Slack app-level Socket Mode token (`xapp-…`).      |

Add the following **variables**, replacing the example organization, Space slug,
workspace ID and channel ID with your actual values:

```env
ML_ASSISTANT_MODE=true
USE_USER_TOKEN=true
MCP_FORWARD_HF_USER_TOKEN=true
ENABLE_CONFIG_MANAGER=false
OPENAI_BASE_URL=https://router.huggingface.co/v1
ML_ASSISTANT_MODELS=[{"id":"zai-org/GLM-5.3-Flash","provider":"together"},{"id":"moonshotai/Kimi-K3","provider":"baseten"}]
MCP_SERVERS=[{"name":"Hugging Face","url":"https://hf.co/mcp?login"}]
ML_ASSISTANT_SERVICE_POLLER=true
ML_ASSISTANT_SERVICE_EVENTS=true
SLACK_ML_ENABLED=false
SLACK_ML_TEAM_ID=T0123456789
SLACK_ML_ALLOWED_CHANNELS=C0123456789
SLACK_ML_BUDGET_USD=0
SLACK_ML_PUBLISH_NAMESPACE=your-company-org
SLACK_ML_BILLING_ORGANIZATION=your-company-org
SLACK_ML_STATE_BUCKET=your-company-org/ml-intern-slackbot-state
MONGODB_DB_NAME=ml-intern-slackbot
PUBLIC_ORIGIN=https://your-company-org-ml-intern-slackbot-server.hf.space
```

Use the actual Space app URL for `PUBLIC_ORIGIN`. For JSON variables, paste the
JSON value directly into Space settings, without extra shell quotes. Select models
and providers available to your account; the examples match the
[local development guide](./local-development.md). Do not pin a different token
inside `MCP_SERVERS`. This Docker image starts its own loopback MongoDB and sets
`MONGODB_URL` internally; no external MongoDB account or secret is required.

### 4. Upload and start

From the checkout root:

```bash
node integrations/slack/space/upload.mjs your-company-org/ml-intern-slackbot-server
```

The helper uploads tracked source files in batches, excludes local env files, and
checks for configured credentials. It installs `integrations/slack/space/Dockerfile`
and `integrations/slack/space/README.md` as the Space's root Dockerfile and README.
The Dockerfile enables ML Intern at build time.

After upload completes and any old worker has stopped, set `SLACK_ML_ENABLED=true`
in Space settings and resume the Space. Check runtime logs for `[state] Restored`,
`[slack] ML Intern connected via Socket Mode`, and subsequent `[state] Backup saved`
messages. The Space restores from the bucket before starting the bot.

### 5. Verify and operate

In the allowed test channel, mention the bot in two separate threads. Ask for a
clarifying question in one and a short answer in the other; the second must finish
while the first waits. Answer the question with **Answer questions** and verify
that each response stays in its own thread. Check an explicitly approved small
compute task separately to validate the organization's Jobs permissions and payer.

Wait for a completed backup, pause and resume the Space, and confirm an existing
thread still works. Verify a pending question can be answered after restart. Then
expand the channel allowlist if desired. Keep the local worker stopped.

Snapshots briefly lock writes while reading all collections, then unlock before
compression/upload. BSON IDs, dates, and indexes survive restore.

Backups run every 30 seconds after the preceding upload completes and on graceful
shutdown. An abrupt crash can lose changes since the last completed backup. Three
consecutive backup failures stop the worker. This is a single-replica pilot, not a
lossless database service. Pause the Space before deploying/restarting it and wait
for shutdown to finish; never run two replicas with independent local databases
against this bucket. A MongoDB lease cannot coordinate independent databases.

Do not connect workers using different databases to the same Slack app concurrently.
The shared-database lease protects replicas using the same MongoDB, but independent
Space databases cannot coordinate through it. Pause the Space and allow its final
backup to finish before every source upload or deployment update.
