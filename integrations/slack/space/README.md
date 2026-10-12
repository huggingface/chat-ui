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
no public Slack callback URL is required. One replica handles four active thread
sessions concurrently. Each thread has its own conversation, budget, files and
question state; only its original invoker can answer or control that session.

Uses a private HF Bucket configured by `SLACK_ML_STATE_BUCKET` for persistent
snapshots, with MongoDB running locally inside the Space. No external MongoDB
account is required. Restores before startup and backs up every 30 seconds and on
shutdown. An abrupt crash can lose updates since the last completed backup.
Run one replica only; pause before deploying to avoid overlapping writers.
Slack and Hugging Face tokens belong in Space secrets, never in this repository.
See `docs/source/ml-intern/slack-bot.md`.
