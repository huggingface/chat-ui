# Running the ML Intern Slack bot

This guide is for operators who run the Slack bot in their own Chat UI deployment. For how to use the bot, see [ML Intern in Slack](../../docs/source/ml-intern/slack-bot.md).

The bot runs inside the Chat UI server and uses the same ML Intern harness and MongoDB state as HuggingChat. It connects to Slack over Socket Mode, so it needs no public event callback. The design follows the thread/session and Socket Mode approach of [Moon Bot](https://huggingface.co/blog/huggingface/moon-bot), but reuses ML Intern's state and tools instead of creating a separate agent.

Each Slack thread has its own persistent conversation, scripts, compute budget and service registry. A worker lease stops several Chat UI replicas from consuming the same Slack app at once. Questions and timed waits resume through the existing server sweepers. Interrupted submissions are never replayed automatically: **Retry** regenerates the original request, without the interrupted assistant turn, and may repeat compute.

## Choose an account mode

| Mode                                    | Setting                      | Who pays and publishes                                                                  | Use it for                                                                                     |
| --------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Personal accounts](#personal-accounts) | `SLACK_ML_ACCOUNT_MODE=user` | Each owner connects their own HF account. Sessions appear in their HuggingChat history. | A Chat UI deployment with HF login, such as HuggingChat. Supports installs from any workspace. |
| [Shared token](#shared-token)           | default                      | One HF token, payer and publishing namespace for everyone the bot serves.               | A dedicated deployment for one company workspace, for example on a Space.                      |

## Create the Slack app

1. Create a Slack app **from a manifest**, using [`manifest.json`](./manifest.json).
2. Install it in your workspace and copy its bot token (`xoxb-…`).
3. Under **Basic Information → App-Level Tokens**, generate a token with `connections:write` (`xapp-…`). The manifest enables Socket Mode and interactivity.
4. Note the workspace ID (`T…`, with no underscore) and invite the bot to the channels where it should work.
5. Store the tokens as secrets. Don't commit them or send them in a Slack message.

All modes need these settings, plus the usual `OPENAI_BASE_URL`, `OPENAI_API_KEY` and `ML_ASSISTANT_MODELS` described in [local development](../../docs/source/ml-intern/local-development.md):

```env
ML_ASSISTANT_MODE=true
USE_USER_TOKEN=true
MCP_FORWARD_HF_USER_TOKEN=true

SLACK_ML_ENABLED=true
SLACK_ML_TEAM_ID=T0123456789
SLACK_ML_BOT_TOKEN=xoxb-your-bot-token
SLACK_ML_APP_TOKEN=xapp-your-app-token
SLACK_ML_BUDGET_USD=0
# Optional: restrict the bot to these channel IDs. If set, DMs must be included explicitly too.
SLACK_ML_ALLOWED_CHANNELS=
```

`ML_ASSISTANT_MODE` must be enabled **when building**. Use persistent MongoDB (or the bucket-backed [Space deployment](#deploy-on-hugging-face-spaces)), and enable the ML service poller, service events and the parked/answered-question sweepers. The integration is disabled by default and adds no inbound endpoint. Don't pin an Authorization header or a different token on the Hub MCP server: startup rejects it, because it would charge compute to the wrong identity.

### Scopes and events

The manifest lists everything the bot needs. For reference:

- history/read scopes to fetch channel and DM threads, and `users:read` to check membership
- `chat:write` for replies and forms, `reactions:write` for the 👀/✅ acknowledgement
- `files:read` for attachments, `files:write` for traces, `im:write` to deliver personal traces privately
- the `message.channels` and `message.groups` bot events for owner replies without a mention
- the `app_uninstalled` and `tokens_revoked` bot events for [public installs](#installs-from-other-workspaces)

Updating the manifest or server doesn't grant an installed token new scopes. When you add one, update the app's settings and reinstall it in every workspace. Without `reactions:write` requests still run, and without the `message.*` events follow-ups still work with a mention. Personal traces never fall back to posting in a channel.

See Slack's [Socket Mode guide](https://docs.slack.dev/apis/events-api/using-socket-mode/) and [thread history API](https://docs.slack.dev/reference/methods/conversations.replies/).

## Personal accounts

With `SLACK_ML_ACCOUNT_MODE=user`, Slack sessions run on the owner's existing HuggingChat authorization and appear in their chat history. This mode needs the **same Chat UI server and database as the web application**. A separate worker replica is fine if it shares the database, configuration and OAuth credentials; the workspace lease still elects one Socket Mode consumer. A standalone Space with its own database doesn't create conversations in HuggingChat.

It reuses the HuggingChat login rather than adding a new OAuth client, remote execution API or sync service.

### Configuration

Keep the normal HuggingChat HF OAuth, model and database configuration, and add:

```env
SLACK_ML_ACCOUNT_MODE=user
PUBLIC_ORIGIN=https://huggingface.co
SLACK_ML_VIEWER_ORIGIN=https://huggingface.co
SLACK_ML_VIEWER_CLIENT_ID=
SLACK_ML_VIEWER_CLIENT_SECRET=
SLACK_ML_VIEWER_SESSION_SECRET=
MCP_OAUTH_ENCRYPTION_KEY=
```

- Use the deployment's HTTPS origin for `PUBLIC_ORIGIN`; the application base path (for example `/chat`) is appended automatically. `SLACK_ML_VIEWER_ORIGIN` must match it. HF must be the configured OpenID provider.
- The viewer client ID and secret come from the Slack app's **Basic Information → App Credentials**, and the session secret is at least 32 random characters (`openssl rand -hex 32`). Register `<PUBLIC_ORIGIN><base>/slack/view/callback` as a redirect URL and enable Sign in with Slack (`openid`). This verifies the Slack identity before an HF account is linked.
- `MCP_OAUTH_ENCRYPTION_KEY` encrypts saved MCP selections and other workspaces' bot tokens. Keep it stable; without it, MCP sync and public installs are disabled.
- The HF OAuth grant must permit the work: `openid profile inference-api read-mcp read-billing contribute-repos jobs`. `contribute-repos` allows creating repositories and accessing those this OAuth app created, not general write access. After adding scopes, users must sign in again, approve the new grant and reconnect Slack; existing tokens don't gain permissions.

### Connections

An unconnected user who mentions the bot gets a private, thread-scoped **Connect Hugging Face** link. The original request isn't queued. Connection links are single-use bearer links that expire after ten minutes and are stored only as hashes. Confirming one requires a signed-in HF browser, a verified Slack OIDC identity matching the ticket, and a same-origin POST. Connection pages are uncached and suppress referrers.

Connections store a reference to the user's HuggingChat OAuth session, not a copy of the token, and reuse its refresh. Valid sessions are extended for two weeks when the worker uses them; expired sessions are never revived. Logging out of huggingface.co alone doesn't revoke a connection: users disconnect on `/slack/connect` or revoke the HF OAuth grant. Disconnecting blocks new requests and automatic continuations, but doesn't cancel running turns or Hub Jobs; Stop controls keep working.

A session's Slack owner and HF owner are pinned. Automatic continuations use the pinned connection, never the most recent browser session. If it has expired, been deleted or no longer matches the original HF account, the session stops instead of falling back to a shared token. Reconnecting a different HF account doesn't reassign older threads.

Connections and thread owners are scoped by Slack user ID and home workspace. Legacy records without a home workspace belong to the installation workspace.

### Isolation and billing

- New personal sessions always start at **$0**, whatever `SLACK_ML_BUDGET_USD` says. Connecting an account never approves a budget.
- Only the owner can submit requests, steer, answer, approve compute, stop, retry or download traces. Other participants can't use the owner's repository permissions, publishing identity or inference billing.
- Personal sessions include only the owner's messages and files from the thread. Other people's messages, files and file names never reach the model, because they would let anyone in the channel steer an agent running on the owner's account. Pasted text is labelled as reference material, but that label isn't a security boundary, and anything the agent fetches can still contain instructions.
- Sessions bill to the owner's HuggingChat billing organization or resource group, or to them personally, and publish to their username by default. `SLACK_ML_HF_TOKEN`, `SLACK_ML_PUBLISH_NAMESPACE` and `SLACK_ML_BILLING_*` don't apply.
- Traces are delivered privately by DM. If Slack doesn't permit the DM, delivery fails rather than posting to the channel.
- In HuggingChat, Slack sessions are read-only. The browser can't send messages, answer questions, change budgets, stop runs or share. Owners can delete a session, which retires its Slack thread and aborts generation but doesn't cancel Hub Jobs.

### MCP servers

Owners can opt in to using their enabled HuggingChat MCP servers in Slack, when connecting or on `/slack/connect`. The next HuggingChat page load uploads the current selection, and later changes in any browser replace it. The most recently changed selection wins; selections aren't merged across devices.

Selections are stored per HF user in `mcp.selections`. Manual headers and server configuration are encrypted with `MCP_OAUTH_ENCRYPTION_KEY`. OAuth tokens aren't copied, only connection IDs, which the normal MCP pipeline checks and refreshes. Each new turn, retry, answer or resumed wait loads the latest selection; a running turn keeps its tools. If a selection can't be decrypted (for example after a key rotation), the turn uses the preset tools and asks the owner to resync. Turning the toggle off, or disconnecting the last Slack account, deletes the selection.

### Slack Connect

In personal-account mode, internal and external members of Slack Connect channels where the bot is present can start sessions with their own HF accounts. `SLACK_ML_ALLOWED_CHANNELS` still applies. External DMs, group DMs and your own workspace's guests aren't supported. Slack's API omits guest status for members of other workspaces, so anyone the shared channel admits from that organization can connect their own account. Users Slack flags as guests, bots, deleted or strangers are rejected.

External channel membership is checked before issuing a connection ticket, at confirmation, before execution and on every control. Events may reuse a positive check for 60 seconds. The Slack app must permit Sign in with Slack for the external user's workspace; verify this with an external test account before rollout. Slack may withhold external file metadata or downloads, which is reported to the requester.

### Installs from other workspaces

A personal-account deployment can let any workspace install its app from `<PUBLIC_ORIGIN><base>/slack/install` (for HuggingChat, `https://huggingface.co/chat/slack/install`). The link goes straight to Slack's consent screen. After **Allow**, the installer lands on a confirmation page and gets a welcome DM. Each person then connects their own HF account, so other workspaces never use a shared token or payer.

`SLACK_ML_TEAM_ID` and its tokens stay the app's home workspace. Other workspaces' bot tokens are stored in `slack.installations`, encrypted with `MCP_OAUTH_ENCRYPTION_KEY`. One Socket Mode connection receives events for every workspace, and each thread acts through its own workspace's token.

```env
SLACK_ML_PUBLIC_INSTALL=true
# Only when Sign in with Slack uses a different app than the bot:
SLACK_ML_CLIENT_ID=123.456
SLACK_ML_CLIENT_SECRET=...
```

Installs use the client ID and secret of the bot's Slack app, which default to `SLACK_ML_VIEWER_CLIENT_ID` and `SLACK_ML_VIEWER_CLIENT_SECRET`. The client must belong to the same app as `SLACK_ML_APP_TOKEN`. If personal-account mode, Sign in with Slack or the encryption key is missing, the bot logs an error and serves only its home workspace. In the Slack app settings:

1. Under **OAuth & Permissions**, add the redirect URL `<PUBLIC_ORIGIN><base>/slack/install/callback`.
2. Under **Event Subscriptions**, subscribe to `app_uninstalled` and `tokens_revoked`. Uninstalling deletes the workspace's token and stops its threads.
3. Under **Manage Distribution**, activate public distribution. This doesn't list the app in the Slack Marketplace, which doesn't accept Socket Mode apps.
4. If Sign in with Slack uses a separate app, activate public distribution for that app too.

Notes:

- Workspaces that require approval show **Request to install**. After an admin approves, opening the link again completes the install. Marketplace-only workspaces can't install a Socket Mode app.
- Org-wide Enterprise Grid installs are rejected; install into individual workspaces.
- An install must grant every bot scope in the manifest. After adding a scope, each workspace must install again.
- To stop serving a workspace, set `disabled: true` on its `slack.installations` record. Reinstalling doesn't clear it, and the change takes effect within 30 seconds.
- A channel shared by two installed workspaces stays one thread, whichever install delivers the event.
- A worker runs at most eight requests at once, and four per workspace.
- `SLACK_ML_ALLOWED_CHANNELS` applies to every workspace, so leave it empty for public installs.

### Rollout

Deploy to the HuggingChat backend, configure Socket Mode there, then enable user mode. Never run the same Slack app against two independent databases at once, because their worker leases can't coordinate: stop any old Space worker first, and back up its state. Existing shared-token threads aren't transferred to personal accounts; keep the shared token configured to continue them, or leave them on the old installation.

On staging, verify HF login and consent, private connection links, chat-history visibility, a small explicitly budgeted job, and two users in separate threads. In a Slack Connect channel, also check that another participant's messages and files stay out of the owner's context, and that their requests and controls are refused.

## Shared token

By default, every session uses one HF token configured on the deployment. This suits a company that runs a dedicated bot for its own workspace. Employees don't connect accounts; their threads have separate conversations and budgets, but all use the same credential and payer.

```env
SLACK_ML_HF_TOKEN=hf_your_shared_token
# Default destination for repos, Spaces, datasets and Trackio dashboards. Empty uses the token owner.
SLACK_ML_PUBLISH_NAMESPACE=your-company-org
# Payer, chosen independently of the publishing destination. Empty uses the token owner.
SLACK_ML_BILLING_ORGANIZATION=your-company-org
# Optional resource group; requires the billing organization above.
SLACK_ML_BILLING_RESOURCE_GROUP=
```

The token needs Inference Providers access, the Hub MCP tools, permission to run Jobs under the payer, and write access to the publishing organization. Both the member's role and the token's scopes must allow each operation; see [HF access tokens](https://huggingface.co/docs/hub/security-tokens). [Organization service accounts](https://huggingface.co/docs/hub/enterprise-service-accounts) haven't been verified end-to-end yet; the tested path is a member token with organization access. Note that `USE_USER_TOKEN=true` also applies to browser chats on a shared deployment.

This is shared service access, so only enable channels whose members may use the credential. The initial budget is per thread, not a company-wide cap, and anyone allowed to invoke the bot can approve budget grants. Configure a nonzero `SLACK_ML_BUDGET_USD` only if they may all spend it.

### Who can do what

The **owner** is the person who first invoked ML Intern in a thread. "Everyone" means members of the installing workspace; guests, bots and Slack Connect channels are excluded, and the channel allowlist applies.

| Action                                                       | Everyone | Owner only |
| ------------------------------------------------------------ | :------: | :--------: |
| Mention ML Intern to ask questions or request follow-up work |    ✓     |            |
| View responses, progress, questions and answers              |    ✓     |            |
| Download the thread's trace (posted to the thread)           |    ✓     |            |
| Request work using the thread's approved budget              |    ✓     |            |
| Set or change the compute budget                             |          |     ✓      |
| Answer questions                                             |          |     ✓      |
| Skip a pending question by sending a new request             |          |     ✓      |
| Steer or continue with replies that skip the mention         |          |     ✓      |
| Stop or retry the assistant                                  |          |     ✓      |

Shared-token sessions include the whole thread as quoted context, since only members of your own workspace can reach them. While a run is working, the owner's requests are queued for its next step; other people's wait until it finishes. Non-owner messages are limited to 10 per person per minute.

## Deploy on Hugging Face Spaces

A shared-token bot can run on a private Docker Space with its state backed up to a private HF bucket.

### 1. Prepare the checkout and Space

Run `npm ci` in a checkout of this repository. Create a **private Docker Space** under the organization, for example `your-company-org/ml-intern-slackbot-server`, with one replica, upgraded CPU hardware and sleep disabled (sleep time `-1`). Keep it paused during setup; the upload helper doesn't configure hardware, secrets or variables.

Create an ignored `.env.local` with `SLACK_ML_DEPLOY_TOKEN`, `SLACK_ML_STATE_TOKEN` and `SLACK_ML_STATE_BUCKET`. Keep the deploy token local, never in the Space.

Use three separate tokens: the shared compute token, a fine-grained `SLACK_ML_STATE_TOKEN` with access only to the state bucket, and an operator-only `SLACK_ML_DEPLOY_TOKEN` for uploads. The compute token must not be able to read the bucket or modify the Space. Startup rejects identical tokens and compute tokens that can read the snapshot, and the state token is never exposed to the Chat UI worker or its tools.

### 2. Initialize state

For a **new installation**, this creates a private bucket and seeds an empty snapshot. It refuses to run if the bucket already exists:

```bash
node --input-type=module <<'JS'
import { config } from "dotenv";
import { createRepo } from "@huggingface/hub";
import { BSON } from "mongodb";
import { gzipSync } from "node:zlib";
import { writeBackup } from "./integrations/slack/space/state.mjs";

config({ path: ".env.local", quiet: true });
const bucket = process.env.SLACK_ML_STATE_BUCKET;
const token = process.env.SLACK_ML_STATE_TOKEN;
if (!bucket || !token) throw new Error("Set SLACK_ML_STATE_BUCKET and SLACK_ML_STATE_TOKEN");
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

If the upload fails after the bucket is created, inspect it before retrying, and never replace `latest.json.gz` once a bot has used the bucket. Startup fails when the snapshot is missing or invalid.

For an **existing installation**, stop its worker and migrate its Slack state with `snapshot`/`writeBackup` from [`space/state.mjs`](./space/state.mjs). Include Slack users, thread/input/delivery records, budgets, questions, waits, files and registry data, and exclude browser sessions and OAuth credentials. Verify a restore before retiring the original database.

### 3. Configure the Space

Add these **secrets**:

| Secret                 | Value                                                  |
| ---------------------- | ------------------------------------------------------ |
| `SLACK_ML_HF_TOKEN`    | The shared HF token with organization access.          |
| `OPENAI_API_KEY`       | The same HF token, used for the startup model catalog. |
| `SLACK_ML_BOT_TOKEN`   | The installed Slack bot token (`xoxb-…`).              |
| `SLACK_ML_APP_TOKEN`   | The Slack app-level Socket Mode token (`xapp-…`).      |
| `SLACK_ML_STATE_TOKEN` | The bucket-only state token.                           |

And these **variables**, with your own values:

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

Paste JSON values directly, without shell quotes, and pick models and providers your account can use. Start with a private test channel in `SLACK_ML_ALLOWED_CHANNELS`. The image runs its own loopback MongoDB, so no external database is needed.

### 4. Upload and start

```bash
node integrations/slack/space/upload.mjs your-company-org/ml-intern-slackbot-server
```

The helper uploads tracked source files in batches, skips local env files, checks for leaked credentials, and installs [`space/Dockerfile`](./space/Dockerfile) and [`space/README.md`](./space/README.md) as the Space's root files. If the Space's README has its own frontmatter, such as `hf_oauth`, pass `--keep-readme`: removing `hf_oauth`, even briefly, deletes the Space's OAuth app and signs everyone out. The helper refuses to upload a README that would drop it.

Once the old worker has stopped, set `SLACK_ML_ENABLED=true` and resume the Space. The logs should show `[state] Restored`, `[slack] ML Intern connected via Socket Mode` and then `[state] Backup saved`.

### 5. Verify and operate

In the test channel, start two threads: one that asks a clarifying question and one with a short answer. The second must finish while the first waits, and each reply must stay in its thread. Separately, run a small, explicitly approved compute task to check Jobs permissions and the payer. Then wait for a backup, pause and resume the Space, and confirm that an existing thread and a pending question still work.

Backups run every 30 seconds and on graceful shutdown, from a consistent snapshot read streamed through gzip without locking writes. An abrupt crash can lose changes since the last completed backup. Failed backups keep the live database and retry with backoff, so monitor `[state] Backup failed`. This is a single-replica setup: pause the Space and let its final backup finish before every deployment, and never run two replicas with independent databases against one bucket.

Version 1 snapshots remain readable and are rewritten as version 2 on the first successful backup. When calling `snapshot`/`readBackup` directly, the result is a temporary file path; call `removeBackup(path)` in a `finally` block.

## Read-only session viewer

Shared-token deployments can show an **Open session** button on each status card. It opens a read-only view on the bot's host with the conversation, tool calls and results, run state, compute reservations and worker heartbeat, refreshed every 15 seconds. Configure `SLACK_ML_VIEWER_*` and the `/slack/view/callback` redirect URL as in [personal accounts](#configuration). Sign in uses Slack's OpenID flow with only the `openid` scope.

- Sign-in is limited to the bot's workspace. Each refresh rechecks eligibility and channel membership; guests, deactivated users and Slack Connect channels are denied, and Slack API failures fail closed. DM sessions require the task owner.
- URLs contain a conversation ID, not a credential. Viewer sessions are independent of HuggingChat sessions and last one hour.
- Responses are `no-store`, can't be framed and send no referrer. Private reasoning, recognized credentials and inline binary data are excluded. It shows the latest 100 messages and up to 200 events per message; **Download trace** gives the complete trace.
- A private Space still enforces its own HF access. To expose only the viewer, put a reverse proxy in front of `/slack/view/`.

## Limits

- Context: up to 200 messages and 24,000 characters from the invoking thread. Follow-ups quote only human messages since the last submitted invocation. The bot doesn't read other channels or linked threads.
- Attachments: files on the invoking message or earlier human messages, up to 10 files, 10 MB each and 25 MB per invocation, downloaded with the bot token into Chat UI's file storage. Download failures are reported in the thread.
- Delivery retries back off and pause after five consecutive failures; a new mention re-enables delivery. Status updates slow down as more threads are watched, targeting at most 30 per minute per workspace.
- Slack context and generated artifacts may be sent to the model provider and Hugging Face tools as part of a task.

## Tests

```bash
npx vitest run --project=server src/lib/server/slack
npx vitest run --project=server src/lib/server/generation/__tests__/askResume.spec.ts src/lib/server/generation/parkedSweeper.spec.ts
npm run check
```

The tests use mocked Slack and model services and an isolated MongoDB. They don't send Slack messages, launch paid compute or exercise real HF or Slack consent flows. Before rollout, mention the bot in a test thread, answer a clarification, approve a small budget and check the returned Space and trace.
