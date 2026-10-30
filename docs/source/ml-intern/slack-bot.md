# ML Intern in Slack

The optional Slack bot runs inside the Chat UI server. Mention **@ML Intern** in a thread, or send it a direct message. For example:

> @ML Intern take the model I linked above and create a Gradio Space for it.

The bot reads that thread (in personal-account sessions, only the owner's messages), then runs the same ML Intern harness used by HuggingChat. It immediately reacts to accepted requests with 👀 before inference and swaps it for ✅ once the run finishes. Replies can tag people who asked the bot something in the thread; other mentions stay plain text. In new threads, its first reply is a persistent status card showing ⏳ _working..._ while a run is active, or its waiting/finished/stopped state, elapsed time in roughly 10-second increments, and Jobs spending, reservations, and budget. The Stop control lives on that card. Each new invocation gets its own status card below the invoking message; earlier cards retain their final state. Answering questions or resuming the same turn updates that turn’s card. Public updates, questions, and final results appear below it. Existing threads receive the card at the bottom because Slack cannot insert a new reply above older messages. Successful Space creation exposes a separate link labeled as still in setup. Progress updates show no private model reasoning or raw tool arguments. It shows numbered questions (1, 2, 3) and lettered options (A, B, C) in separate sections without repeating the question below the choices. A single-choice question with up to five options has inline buttons with an explicit confirmation, including the exact amount for budget grants. Forms with two to five single-choice questions and up to five options each also show inline choices. Selections refresh directly after each click and are saved as drafts; **Submit answers** appears after every question has a selection and confirms them together, including any budget amount. Changing a selection invalidates an older submit button. Longer or multi-select forms use the **Answer questions** modal. A divider follows the questions and controls; compute totals live in the status card. Inline choices omit that redundant button; an **Other answer** button remains when custom answers are allowed. After submission, the original question card marks confirmed choices with ✅ and removes its controls. Custom answers appear underneath their question. A divider follows the last answer, and the assistant continues below the card without posting a duplicate answer summary. Previously answered private forms are not retroactively published. Results also appear in the thread. Workspace members can mention the bot in an existing channel thread to participate in the same conversation. The original task owner remains the only person who can approve budgets, submit question forms, or stop or resume the task. In shared-token mode, workspace members can use **Download trace** in a channel thread; personal-account traces are owner-only and delivered by DM. DM traces remain private to the DM owner. Participants share that thread's existing approved budget; other threads and DMs remain separate sessions. In channels, the owner's thread replies need no mention; other participants still mention the bot. In DMs, no mention is needed.

Public run updates are retained in a separate, cumulative message in the Slack thread. Earlier results, links, and instructions remain readable as the compact status card changes or becomes a question or final response. Only public assistant text is shown, never private reasoning. Long updates continue in additional messages. Public commentary is published before the question it leads to. After an answer, only new commentary appears below it; earlier text is not replayed. Final results are posted as a new message after progress updates.

Each thread has its own persistent conversation, scripts, compute budget and service registry. MongoDB keeps this state across restarts. A worker lease prevents multiple Chat UI replicas from consuming the same Slack workspace at once. Questions and timed waits resume through the existing server sweepers. Interrupted submissions are not automatically replayed. **Retry** regenerates the original request, omitting the interrupted assistant turn, and may repeat compute. Inspect existing jobs before confirming Retry. **Stop assistant** stops the agent, including a parked wait; it does not cancel Jobs already launched on the Hub. The private stop confirmation appears inside that same Slack thread.

This takes the thread/session and Socket Mode approach described in [Moon Bot](https://huggingface.co/blog/huggingface/moon-bot), while reusing ML Intern's MongoDB state and tool harness instead of creating a separate Pi agent. **Download trace** uploads shared-token conversations as JSONL to the original Slack thread; personal-account traces are available only to the owner and are sent by DM. Long answers are split into messages; no public conversation share is created.

## Thread permissions

The table below describes shared-token sessions. In personal-account mode, only the session owner can submit requests; other channel members can read the public Slack messages, but cannot download personal traces.

The **owner** is the person who first invoked ML Intern in that thread, which may be different from the person who posted the thread's first message.

| Action                                                       | Everyone in the channel | Owner only |
| ------------------------------------------------------------ | :---------------------: | :--------: |
| Mention ML Intern to ask questions or request follow-up work |            ✓            |            |
| View responses, progress, questions, and confirmed answers   |            ✓            |            |
| Download the thread's trace                                  |            ✓            |            |
| Request work using the thread's existing approved budget     |            ✓            |            |
| Set or change the compute budget                             |                         |     ✓      |
| Submit answers through question buttons or forms             |                         |     ✓      |
| Skip a pending question by sending a new request             |                         |     ✓      |
| Steer or continue with thread replies that skip the mention  |                         |     ✓      |
| Stop the assistant                                           |                         |     ✓      |
| Retry an interrupted or failed task                          |                         |     ✓      |
| Open a personal session in HuggingChat                       |                         |     ✓      |

“Everyone” means eligible members of the same Slack workspace. Guests and bots are excluded; the configured channel allowlist also applies. Shared-token sessions cannot run in Slack Connect channels. A trace download posts the file only to its original thread.

Each thread has its own conversation and budget. DMs are separate private sessions, with the person messaging the bot as owner. In channels, the owner's replies in the thread reach ML Intern without a mention, like sending another message in HuggingChat. While a run is working, the reply is queued and read at the run's next step to steer it; otherwise, it starts the next turn. Other participants still need to mention the bot. To keep a channel message out of the run, start it by tagging the person or group it is for (a user, user group, @here, @channel or @everyone) without also tagging the bot; the sender gets a private note that it was not sent. Untagged owner replies are always treated as requests, and they are not rate limited. Other messages are limited to 10 per person per minute; the sender gets a private note when one is dropped. In DMs every message is sent, including ones that start with a tag. If the assistant is waiting on its own question, a new request from the task owner skips that question and starts a new turn with the shared context and existing budget. The old card is marked as skipped and its buttons are removed. Skipping never grants a budget, and stale answer buttons cannot approve a skipped question. Other participants cannot dismiss the owner’s question. If the model is actively working without a pending question, the owner's request is queued for its next step; requests from others wait until it finishes, or the owner can stop it.

## Connect personal Hugging Face accounts

Use `SLACK_ML_ACCOUNT_MODE=user` to create Slack sessions in the owner's HuggingChat history and run them using that person's existing HF authorization. This mode uses the **same Chat UI server and database as the web application**. For sessions to appear on `hf.co/chat`, deploy the worker with the HuggingChat backend, not a standalone Space with its own database. A separate worker replica is possible if it shares the application's database, configuration, and OAuth credentials. The workspace lease still elects one Socket Mode consumer.

This design reuses HuggingChat login rather than introducing a new OAuth scope, OAuth client, remote execution API, or conversation synchronization service. The standalone Space mode remains available below for installations that want a shared account. Deploying a standalone Space does not create conversations in production HuggingChat.

### Slack Connect with personal accounts

With `SLACK_ML_ACCOUNT_MODE=user`, internal and external channel members can start sessions in Slack Connect channels where the bot is present. `SLACK_ML_ALLOWED_CHANNELS` still applies; leave it empty for all eligible channels or list selected channel IDs. New shared-token requests and trace downloads are blocked in externally shared channels. If an internal channel is shared while a legacy run is already active, its output can still be delivered: stop that run before sharing the channel. External DMs, group DMs and guests of your own workspace are not enabled by this change. Slack's API omits guest status for members of other workspaces, so a guest of the external organization cannot be told apart from a full member: anyone the shared channel admits from that organization can connect their own HF account. Users Slack explicitly flags as guests, bots, deleted or strangers are still rejected.

Every new owner must connect their own HF account. The connection ticket records the bot installation workspace separately from the user's home workspace, obtained from Slack's `users.info`. Sign in with Slack targets that home workspace and must return the exact user and workspace bound to the ticket. External channel membership is checked before issuing a ticket, again at account confirmation, and before execution and on controls. Incoming events may reuse a positive eligibility check for up to 60 seconds, but dispatch and controls check fresh membership. Mentions are limited to ten per user per minute before Slack API calls. Channel membership or a shared connection link never grants access to another user's HF account.

Connections and personal thread owners are scoped by both Slack user ID and home workspace. Legacy records without a home workspace are treated as belonging to the installation workspace.

The first invoker owns the thread. Other participants' replies alone do not trigger the bot, and their mentions in an owned personal session are refused. Only the owner can steer, answer questions, approve compute, stop, resume, or download traces. Public assistant replies are visible to everyone in the shared channel, including external organizations; keep that audience in mind when asking about private repositories. HuggingChat inspection remains owner-only and read-only. The status button displays the owner’s HF username to channel participants.

Personal sessions read only the owner's own messages and files from the thread. Other people's messages, files and file names never reach the model, because they would let anyone in the channel steer an agent that runs on the owner's HF account and MCP servers. Shared-token sessions keep the whole thread as quoted context: they run only for members of your own workspace, who can already mention the bot directly. To use someone else's message, paste or quote it into your own; the prompt treats pasted text as reference material, not instructions, though that label is not a security boundary. What the agent fetches itself (web pages, repositories, MCP results) can still contain instructions, and replies are visible to everyone in the channel, so keep the audience in mind when asking about private data.

The Slack app must permit Sign in with Slack for the external user's workspace. Workspace app-approval/distribution policies can prevent consent even when the bot is visible in a shared channel; verify this with an external test account before rollout. No additional bot scope is required beyond the manifest's existing channel-history, member-read and file permissions. Slack may withhold external file metadata or deny downloads; such failures are reported to the requester. Personal trace delivery remains private by DM; if Slack does not permit that DM, it reports failure and never uploads the trace to the shared channel. The owner can inspect the session in HuggingChat instead.

Live rollout checks: use two workspaces in a shared channel, connect an external owner's HF account, start a zero-budget session, and check that another participant's messages and files are not in its context. Verify owner steering and controls, rejection of another participant's requests/controls, removal of channel membership, and private HuggingChat access. Verified live: the event envelope identifies the installing workspace, and `users.info` returns external members without guest flags. To let other companies install the bot in their own workspaces, see [Other workspaces](#other-workspaces).

### Server configuration

Keep the normal HuggingChat HF OAuth, model, and database configuration, and set:

```env
SLACK_ML_ACCOUNT_MODE=user
SLACK_ML_ENABLED=true
SLACK_ML_TEAM_ID=T0123456789
SLACK_ML_BOT_TOKEN=xoxb-your-bot-token
SLACK_ML_APP_TOKEN=xapp-your-app-token
PUBLIC_ORIGIN=https://huggingface.co
ML_ASSISTANT_MODE=true
USE_USER_TOKEN=true
MCP_FORWARD_HF_USER_TOKEN=true
```

Use the deployment's actual HTTPS origin for `PUBLIC_ORIGIN`; the configured application base path (for example `/chat`) is appended automatically. HF must be the configured OpenID provider. Configure `SLACK_ML_VIEWER_ORIGIN` to the same origin as `PUBLIC_ORIGIN`, plus `SLACK_ML_VIEWER_CLIENT_ID`, `SLACK_ML_VIEWER_CLIENT_SECRET`, and `SLACK_ML_VIEWER_SESSION_SECRET` as described in the Slack OIDC setup below. Register `/slack/view/callback` (including the application base path) as a redirect URL and enable Sign in with Slack (`openid`). This verifies the Slack identity before linking an HF account. Do not configure a pinned Authorization header on the Hub MCP server: startup rejects that configuration because it would override the user's credentials. The normal startup model-catalog credential is still needed.

The HF OAuth grant must permit the requested work. Configure `openid profile inference-api read-mcp read-billing contribute-repos jobs`. The `contribute-repos` scope permits repository creation and access to repositories created by this OAuth app, including model artifacts, datasets, and Spaces; it does not grant general write access to existing repositories. After adding scopes, users must sign in again, approve the updated grant, and reconnect Slack so the bot uses the new session. Existing tokens do not automatically gain permissions. Validate the grant with a small job, repository creation, and artifact upload before rollout.

### User connection and access

1. Mention ML Intern. The bot sends a private, thread-scoped **Connect Hugging Face** link to an unconnected user. It does not queue the original request or start inference.
2. Sign in using the existing HuggingChat HF login. The confirmation page identifies the HF account and Slack user/workspace and explains billing and collaboration. Confirm only a link you requested yourself.
3. Mention ML Intern again. The new session belongs to that HF account, appears in its chat history, and includes an **Open in HuggingChat (username)** button on the Slack status card. The username identifies the owning HF account; browser access remains owner-only.
4. Approve any compute budget explicitly. New personal sessions always start at **$0**, even if `SLACK_ML_BUDGET_USD` is nonzero. OAuth authorization and account connection never approve a job budget. Inference can incur charges separately.

The session's original Slack owner and HF owner are pinned. Only the owner can submit requests in personal sessions. Other participants cannot use the owner's private/org repository permissions, publishing identity, or uncapped inference billing. Shared-token sessions retain their existing collaboration behavior. Only the owner can approve budgets or answer the bot's forms. The normal HuggingChat authorization checks protect the private browser conversation; Slack channel membership alone does not grant browser access. Personal runs include only the owner's own messages and attachments from the thread. Other participants' messages never reach the model, authorize spending or trigger a turn. Other channel participants can see the bot’s public messages, but raw personal traces are owner-only and delivered privately by DM. The browser view is read-only; continue these sessions in Slack and use a separate Chat UI conversation for private work.

Personal Slack sessions can also use the owner's enabled HuggingChat MCP servers, alongside ML Intern's built-in tools. This is opt-in: tick the box when connecting, or use the toggle on the Slack connect page afterwards. Tool results may be posted into the Slack thread, so its participants can see information returned by the owner's tools. Until you opt in, nothing is uploaded and Slack sessions use only the deployment/preset tools.

After opting in, the next HuggingChat page load in that browser uploads its current selection. From then on, adding, removing, enabling, disabling or reconnecting a server updates the saved selection. Opening HuggingChat in another browser or a private window does not replace the saved selection; only a change made there does. The most recently changed browser selection is used, not a combination of all servers from every device. Disabled servers are not enabled just because they were previously added.

Selections are scoped to the authenticated HF user in `mcp.selections`. Manual headers and server configuration are encrypted using the existing `MCP_OAUTH_ENCRYPTION_KEY`; without a key the connect page hides the opt-in and nothing is synchronized, so configure a stable one. OAuth access/refresh tokens are not copied: only connection IDs are saved, and the normal MCP pipeline checks their owner and server URL and refreshes credentials when needed. Reauthorization still happens in HuggingChat. The browser reports sync failures rather than silently claiming the selection was saved. Turning the toggle off, or disconnecting your last Slack account, deletes the saved selection.

Each new Slack turn, retry, question-answer continuation, queued follow-up or resumed wait loads the latest saved selection. An already-running turn retains its existing tool set. If the saved selection cannot be decrypted (for example after an encryption-key rotation), the turn runs with the preset tools only and the bot asks the owner to open HuggingChat to resync. Legacy shared-token sessions do not inherit personal MCP selections. Sync operates only when personal Slack mode is enabled on the same deployment; a staging Space cannot read selections saved in production HuggingChat.

Personal sessions use the owner's current HuggingChat billing organization/resource-group settings, or personal billing if none is selected. Their default publishing namespace is their HF username, with explicit task destinations subject to HF permissions. Shared deployment settings (`SLACK_ML_HF_TOKEN`, `SLACK_ML_PUBLISH_NAMESPACE`, and `SLACK_ML_BILLING_*`) do not supply credentials or defaults for personal sessions. Choosing a publishing org does not select it as the payer.

Connections store a reference to the user's existing HuggingChat OAuth session, not a duplicate access token. Existing HF token refresh is reused. Valid sessions are extended for two weeks when the Slack worker uses them; expired sessions are never revived. Logging out of that browser session or replacing it can still require reconnecting Slack. Automatic question and timed-wait continuations resolve the pinned connection, never whichever browser session was most recently used. Expiration, HuggingChat session deletion, disconnection, or a mismatch with the original HF account blocks continuation instead of falling back to the shared token. Reconnect the original HF account and mention the bot again or use Resume; uncertain submissions are not automatically replayed.

Slack usage does not extend the browser session lifetime (normally two weeks). Logging out of huggingface.co alone does not revoke a stored HuggingChat connection; disconnect it on `/slack/connect` or revoke the HF OAuth grant.

Visit `/slack/connect` under the application's base path to list and individually disconnect Slack identities linked to the signed-in HF account. This prevents new Slack requests and future automatic continuations using those connections; it does not cancel already running turns or Hub Jobs. Existing Slack Stop controls remain usable without a valid compute token. Connection links are private bearer links, expire after ten minutes, are stored only as hashes, and can be confirmed only once using a signed-in HF browser, a verified Slack OIDC identity matching the ticket, and a same-origin POST. Existing links created before identity verification was introduced must be reconnected. Do not forward them. Connection pages are uncached and suppress referrers.

Existing shared-token threads are not transferred to personal accounts. If their original state is retained in the same deployment, keep the original shared token to continue them; otherwise leave them on the old installation. New threads use personal accounts after enabling user mode. Switching an account connection to another HF account does not reassign older personal threads; those require reconnecting their original account.

### Rollout

Deploy this branch and the parent Slack PR to the HuggingChat backend, configure Socket Mode there, then enable user mode. Do not run the same Slack app simultaneously against two independent databases: their worker leases cannot coordinate. Stop the old Space worker before switching Slack event handling to production. Back up legacy Space state before retiring it; importing that state is not part of account linking.

Before rollout, verify HF login/consent, private connection links, chat-history visibility, a small explicitly budgeted job, and two users in separate threads on a staging deployment. Local tests exercise identity isolation, expiration, single-use linking, budget approval/resume, and the existing Slack flows; they do not validate production HF consent or billable jobs.

## Install in a workspace (shared account)

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

Shared-token mode accepts only installing-workspace members in internal channels and DMs. Personal-account mode also accepts eligible external members of Slack Connect channels where the bot is present. Guests, bots, deleted users, and external users who are not members of the particular shared channel are excluded. The optional channel allowlist is a further restriction. It reads up to 200 messages from the invoking thread, with a 24,000-character context bound. It does not search other channels or read linked Slack threads. Accessible thread attachments are downloaded subject to the limits below. If context is missing, provide the model URL or ID explicitly. Slack context and generated artifacts may be sent to the model provider and Hugging Face tools as part of the requested task.

For an existing installation, add the **reactions:write** bot scope under **OAuth & Permissions**, then reinstall the app to the workspace to enable the 👀 acknowledgement. Updating the manifest or server alone does not grant the installed token a new scope. If the reaction fails, the request still runs. No separate receipt message is posted.

Owner replies without a mention need the `message.channels` and `message.groups` bot events. For an existing installation, add them under **Event Subscriptions → Subscribe to bot events** and reinstall the app. Without them, channel follow-ups still work with a mention.

The Slack app needs the history/read scopes in the manifest to retrieve channel or DM threads, `users:read` to check membership, `chat:write` for replies/forms, `files:write` for requested traces, and `im:write` to deliver personal traces privately. Existing installations must add `im:write` and reinstall the Slack app; personal traces never fall back to posting in a channel. See Slack's [Socket Mode guide](https://docs.slack.dev/apis/events-api/using-socket-mode/) and [thread history API](https://docs.slack.dev/reference/methods/conversations.replies/).

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
repos and Spaces in the publishing organization. It must not access the state bucket
or modify the bot server Space. Use a separate bucket-only `SLACK_ML_STATE_TOKEN`
for persistence and an operator-only `SLACK_ML_DEPLOY_TOKEN` for server uploads. Check the organization's billing setup,
credits, and hardware quotas for the operations you intend to allow.

Replace `your-company-org` with the actual HF organization slug:

```env
SLACK_ML_PUBLISH_NAMESPACE=your-company-org
SLACK_ML_BILLING_ORGANIZATION=your-company-org
# Optional resource group for billing; requires the billing organization above.
SLACK_ML_BILLING_RESOURCE_GROUP=
SLACK_ML_STATE_BUCKET=your-company-org/ml-intern-slackbot-state
SLACK_ML_STATE_TOKEN=hf_separate_bucket_only_token
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
A personal-account deployment can instead let the company install the hosted app
from a link; see [Other workspaces](#other-workspaces).

## Other workspaces

A personal-account deployment can let any Slack workspace install its app from one link: `<PUBLIC_ORIGIN><base>/slack/install` (for HuggingChat, `https://huggingface.co/chat/slack/install`). The link goes straight to Slack's consent screen. After **Allow**, the installer lands on a page naming the workspace, with an **Open Slack** button, and the bot sends them a welcome DM. Each person then mentions the bot and connects their own HF account through the usual private link, so other workspaces never use a shared HF token or a shared payer.

`SLACK_ML_TEAM_ID` and its tokens remain the app's home workspace. Every other workspace's bot token comes from its install and is stored in `slack.installations`, encrypted with `MCP_OAUTH_ENCRYPTION_KEY`. One Socket Mode connection receives events for every workspace, and each thread acts through its own workspace's token. Turn it on with:

```env
SLACK_ML_PUBLIC_INSTALL=true
SLACK_ML_CLIENT_ID=123.456
SLACK_ML_CLIENT_SECRET=...
MCP_OAUTH_ENCRYPTION_KEY=...
```

Startup refuses public installs in shared-token mode or without these values. The client ID and secret are on the Slack app's **Basic Information** page; they must belong to the same app as `SLACK_ML_APP_TOKEN`, and the install is rejected otherwise. In the Slack app settings:

1. Under **OAuth & Permissions**, add the redirect URL `<PUBLIC_ORIGIN><base>/slack/install/callback`.
2. Under **Event Subscriptions**, subscribe to the `app_uninstalled` and `tokens_revoked` bot events. Uninstalling the app deletes the workspace's token and stops its threads.
3. Under **Manage Distribution**, activate public distribution. This does not list the app in the Slack Marketplace, which does not accept Socket Mode apps.
4. Sign in with Slack must also work for other workspaces. If `SLACK_ML_VIEWER_CLIENT_ID` belongs to a separate Slack app, activate public distribution for that app too.

Notes:

- Workspaces that require app approval show **Request to install**. After an admin approves it, opening the link again (or Slack's own install button) completes the install.
- Workspaces that allow only Marketplace apps cannot install a Socket Mode app.
- Org-wide Enterprise Grid installs are rejected; install into individual workspaces instead.
- An install must grant every bot scope in the manifest. After adding a scope, each workspace has to install again.
- To stop serving a workspace, set `disabled: true` on its `slack.installations` record. Reinstalling does not clear it. Changes take effect within 30 seconds.
- A channel shared by two workspaces that both installed the app stays one thread, whichever install Slack delivers an event through.
- A worker runs at most eight requests at once, and at most four per workspace.
- `SLACK_ML_ALLOWED_CHANNELS` applies to every workspace, so leave it empty for public installs.

A standalone shared-token deployment still serves only its own workspace. Another company that wants a shared HF token creates the same app from the manifest and runs its own instance; see [Company Slack with a Hugging Face organization](#company-slack-with-a-hugging-face-organization).

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

Create an ignored `.env.local` in the checkout with `SLACK_ML_DEPLOY_TOKEN`,
`SLACK_ML_STATE_TOKEN`, and `SLACK_ML_STATE_BUCKET`. Keep the deployment token local;
do not install it in the worker Space. The upload helper
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
SLACK_ML_STATE_TOKEN=hf_separate_bucket_only_token
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
The Dockerfile enables ML Intern at build time. If your Space's README has its own
frontmatter, such as `hf_oauth` for HuggingChat login, pass `--keep-readme` to leave it
in place: removing `hf_oauth`, even briefly, deletes the Space's OAuth app and signs
everyone out. The helper refuses to upload a README that would drop it.

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

Snapshots use consistent snapshot reads and stream compressed records without
locking application writes. BSON IDs, dates, and indexes survive restore.

Backups run every 30 seconds after the preceding upload completes and on graceful
shutdown. An abrupt crash can lose changes since the last completed backup. Backup failures retain the live database and back off retries; monitor the logs. This is a single-replica pilot, not a
lossless database service. Pause the Space before deploying/restarting it and wait
for shutdown to finish; never run two replicas with independent local databases
against this bucket. A MongoDB lease cannot coordinate independent databases.

Do not connect workers using different databases to the same Slack app concurrently.
The shared-database lease protects replicas using the same MongoDB, but independent
Space databases cannot coordinate through it. Pause the Space and allow its final
backup to finish before every source upload or deployment update.

## Attachments

Files attached to the invoking message or earlier human messages in the same Slack thread are downloaded with the bot token and attached to the ML Intern conversation through Chat UI's upload pipeline. This supports image requests such as OCR. Files posted after the invocation and bot-uploaded files are excluded. Limits are 10 distinct files, 10 MB per file, and 25 MB total per invocation. Start a fresh thread to select a smaller set. Download failures are reported privately in the thread rather than silently running without the image.

The app requires the **files:read** bot scope. For an existing installation, add it under **OAuth & Permissions → Bot Token Scopes**, then reinstall the app to your workspace. Updating the repository manifest alone does not grant permission to an already-installed bot. Attachments stay in the conversation's file storage; they are not made public on Slack.

### State isolation and backup format

`SLACK_ML_STATE_TOKEN` must be a separate fine-grained token with access only to the private state bucket. Restrict the compute token so it cannot read or write that bucket, even if both tokens belong to the same account. Merely issuing two broad tokens does not isolate state. Startup rejects identical tokens and rejects compute credentials that can read the seeded snapshot. The state token is removed from the Chat UI worker's environment and is never forwarded to tools. Existing installations must configure this new secret before deploying this change.

The Space starts a local single-node MongoDB replica set for snapshot reads. Backups use one snapshot read timestamp, stream individual BSON-preserving EJSON records through gzip into a temporary file, and upload from disk. There is no global write lock or database-sized string. Temporary files are removed after upload. Version 1 seeds/backups remain readable for migration; the first successful backup rewrites them as version 2. Legacy version 1 import still requires memory for its single JSON document. When using `snapshot`/`readBackup` directly, their result is now a temporary file path; call `removeBackup(path)` in a `finally` block after use.

Backup failures retain the running database and retry with increasing delay instead of restarting into an older snapshot. Operators must monitor `[state] Backup failed` logs; a crash while backups are failing can still lose data. Local disk must have room for the compressed snapshot.

Thread delivery retries back off and pause after five consecutive failures; a new mention re-enables delivery. Polling advances even when delivery fails, and inactive threads with no pending inputs are unwatched. Status animation slows as watched-thread count grows, targeting at most 30 status updates/minute across the workspace (other Slack calls also consume rate limits). Delivery records are retained to prevent replay; an index supports question-card lookups. Follow-ups quote only human context since the last successfully submitted invocation; long initial threads keep the most recent 200 human messages.

## Read-only session viewer (legacy shared-account sessions)

The optional viewer runs on the bot's Chat UI host, not `hf.co/chat`. When configured, **Open session** appears on each Slack status card. It shows the conversation, expandable tool arguments/results/errors, run state, compute reservations, and latest worker heartbeat. It refreshes every 15 seconds while visible, with a manual refresh button. It does not offer sending messages, submitting answers, approving budgets, stopping runs, or resuming them. Those actions remain in Slack.

### Enable Slack sign-in

1. In your Slack app, open **Basic Information → App Credentials** and obtain its **Client ID** and **Client Secret**. Bot and Socket Mode tokens cannot replace these credentials.
2. In **OAuth & Permissions → Redirect URLs**, add the exact callback URL for your bot host: `https://YOUR-BOT-HOST/slack/view/callback`. With an application base path, include that path before `/slack/view/callback`.
3. Configure the following on the bot server, storing secrets in Space **Secrets**, never committed files:

   | Setting                          | Value                                                                                  |
   | -------------------------------- | -------------------------------------------------------------------------------------- |
   | `SLACK_ML_VIEWER_ORIGIN`         | The HTTPS origin only, e.g. `https://abidlabs-ml-intern-slackbot-server.hf.space`      |
   | `SLACK_ML_VIEWER_CLIENT_ID`      | Slack app Client ID                                                                    |
   | `SLACK_ML_VIEWER_CLIENT_SECRET`  | Slack app Client Secret                                                                |
   | `SLACK_ML_VIEWER_SESSION_SECRET` | Random signing secret of at least 32 characters, e.g. output of `openssl rand -hex 32` |

4. Restart the bot. Open **Open session** on a status card, then **Sign in with Slack**. This uses Slack's separate OpenID flow with only the `openid` scope, not a new bot installation grant. Existing `users:read`, `channels:read`, and `groups:read` bot scopes are used to verify membership.

For `abidlabs/ml-intern-slackbot-server`, the callback is `https://abidlabs-ml-intern-slackbot-server.hf.space/slack/view/callback`. The host must also be reachable by the intended viewers. A private HF Space still enforces its own Hugging Face access requirements; signing in with Slack does not bypass them. Do not expose the rest of a privately configured Chat UI installation merely to publish this viewer; a reverse proxy can expose only `/slack/view/` if broader access is needed.

### Access and data handling

- Sign-in is restricted to the bot's configured Slack workspace. Each data refresh rechecks current user eligibility and channel membership using the bot token. Guests, deactivated users, and Slack Connect channels are denied. Slack API outages or rate limits fail closed.
- Channel sessions require channel membership. DM sessions require the original task owner. The bot's channel allowlist still applies.
- URLs contain a conversation ID, not a bearer credential. Forwarding a URL does not grant access. Slack browser sessions are independent of HuggingChat sessions and cannot authorize existing Chat UI mutation endpoints.
- OAuth uses signed, short-lived state cookies and OpenID validation of signature, issuer, audience, expiration, state, and nonce. The session cookie is Secure, HttpOnly, SameSite=Lax, and expires after one hour. Slack OAuth access tokens are not persisted. Rotating the session signing secret invalidates all viewer logins.
- Pages and API responses are `no-store`, cannot be framed, and send no referrer. Trace text is rendered as text, never HTML. Private reasoning, recognized credentials and inline binary data are excluded. Tool outputs may still contain sensitive workspace content, so access is restricted to the original audience.
- The viewer displays the latest 100 non-system messages and up to 200 diagnostic events per message, with long values limited to 24,000 characters. It is a bounded diagnostic view, not a full raw trace export. The existing **Download trace** action in Slack remains available for complete traces.

OAuth must be tested against your real Slack app after configuration. Automated tests cover access denial, state/nonce handoff, cookie tampering, redaction, and browser rendering; they do not substitute for a real Slack consent flow.

### Slack sessions in Chat UI are read-only

Sessions started by the Slack bot can be inspected in Chat UI, including their messages and traces. Continue the conversation in Slack using the **Continue in Slack** link. The browser cannot send or edit messages, retry responses, answer questions, change the session budget, stop runs, share it, or stop registry services. Owners can delete individual sessions or clear history. Deletion retires the associated Slack thread and aborts active generation; start a new Slack thread to invoke the bot again. Already running Hub jobs are not cancelled. The server also rejects conversation mutations through HTTP APIs, so opening a second interface cannot take control of a Slack run. Normal conversations created in Chat UI remain editable.
