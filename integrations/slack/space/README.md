---
title: ML Intern Slack Bot
emoji: 🤖
colorFrom: yellow
colorTo: yellow
sdk: docker
app_port: 7860
suggested_hardware: cpu-upgrade
---

ML Intern Slack worker, powered by the Chat UI ML Intern engine.

Runs on upgraded CPU hardware with sleep disabled. Slack uses Socket Mode;
no public event callback URL is required. Account linking additionally uses a
Slack OpenID callback. One replica handles four active thread
sessions concurrently. Each thread has its own conversation, budget, files and
question state; only its original invoker can answer or control that session.

Uses a private HF Bucket configured by `SLACK_ML_STATE_BUCKET` for persistent
snapshots using a separate bucket-only `SLACK_ML_STATE_TOKEN` that the compute
token cannot access. This secret is withheld from the Chat UI worker. Backups stream
compressed records from snapshot reads without blocking writes, with MongoDB running locally inside the Space. No external MongoDB
account is required. Restores before startup and backs up every 30 seconds and on
shutdown. An abrupt crash can lose updates since the last completed backup.
Run one replica only; pause before deploying to avoid overlapping writers.
Slack and Hugging Face tokens belong in Space secrets, never in this repository.
See `docs/source/ml-intern/slack-bot.md`.

## Personal-account staging

Use a separate Space, private bucket, and Slack app to test personal-account mode.
Never reuse the live app's bot or Socket Mode tokens across independent databases.
Set `SLACK_ML_ACCOUNT_MODE=user`, restrict `SLACK_ML_ALLOWED_CHANNELS` to a test
channel, and enable Slack only after configuring the test app's credentials.
Configure `SLACK_ML_VIEWER_ORIGIN` to match `PUBLIC_ORIGIN`, plus the Slack
OpenID client ID, client secret, and session secret (`SLACK_ML_VIEWER_*`).
Enable Sign in with Slack with the `openid` scope and register
`https://<space-app-host>/slack/view/callback` as its redirect URL. Personal mode
requires this identity verification before linking HF accounts.

To use the Space's built-in HF login, add `hf_oauth: true` and
`hf_oauth_scopes: [inference-api, read-mcp, read-billing, contribute-repos, jobs]` to its README
metadata. The startup script maps the injected `OAUTH_CLIENT_ID`,
`OAUTH_CLIENT_SECRET`, and `OAUTH_SCOPES` to Chat UI's `OPENID_*` settings unless
an explicit `OPENID_CLIENT_ID` is already configured. Set `PUBLIC_ORIGIN` to the
Space's HTTPS app origin. Login and compute consent still require the user's
approval. `contribute-repos` permits repository creation and access to repositories
created by this OAuth app, including model artifacts and Spaces. After adding a
scope, users must sign in again, approve the updated grant, and reconnect Slack;
existing tokens do not automatically gain permissions. Test conversations appear in this Space's chat history, not hf.co/chat.

Keep the Space private for an owner-only test; other testers will need access
to the deployment. Seed a fresh empty state bucket rather than copying production
sessions. Give the backup process a bucket-only `SLACK_ML_STATE_TOKEN`; do not
install the operator's deployment token in the Space. Personal mode does not need
a shared compute token.
