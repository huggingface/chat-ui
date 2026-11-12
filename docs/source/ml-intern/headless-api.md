# Headless runs API

Pipelines can start ML Intern without a browser, poll it, and stop it over HTTP. Each run is an ordinary ML Intern conversation, using the same harness, budget gate, waits and sweepers as HuggingChat. A run that parks on a Job resumes on its own.

Runs execute as the Hugging Face account that owns `ML_HEADLESS_HF_TOKEN`. The token is read from server configuration on every resume and never stored with a conversation. The run is stored under that account's real HF id, so signing in to the UI as the same account shows every run as a normal conversation, where you can read the trace or answer a question.

## Enable it

```env
ML_ASSISTANT_MODE=true
MCP_FORWARD_HF_USER_TOKEN=true

ML_HEADLESS_ENABLED=true
ML_HEADLESS_HF_TOKEN=hf_bot_account_token
# Hard cap on the budget any single run may request.
ML_HEADLESS_MAX_BUDGET_USD=25
# Optional: default destination for repos, and who pays for inference, Jobs and sandboxes.
ML_HEADLESS_PUBLISH_NAMESPACE=ML-Intern-lab
ML_HEADLESS_BILLING_ORGANIZATION=ML-Intern-lab
ML_HEADLESS_BILLING_RESOURCE_GROUP=
# Optional: other HF usernames allowed to call the API.
ML_HEADLESS_ALLOWED_USERS=
```

The server provisions the token's account as a user at startup. Callers authenticate with `Authorization: Bearer <HF token>`. A caller must be either the token's own account or listed in `ML_HEADLESS_ALLOWED_USERS`, and listed users must have signed in to the app once. With the feature off, every endpoint returns 404.

## Start a run

```bash
curl -X POST "$CHAT_UI/api/v2/ml-intern/runs" \
  -H "Authorization: Bearer $HF_TOKEN" -H "Content-Type: application/json" \
  -d '{"prompt": "Build a Gradio Space for …", "budgetUsd": 10, "title": "2611.00883 · bestrand-demo"}'
```

`budgetUsd` is the run's compute budget for Jobs and sandboxes; inference is billed separately. A value above `ML_HEADLESS_MAX_BUDGET_USD` is refused. The response (201) is the run's current state, below. Nobody is there to answer questions, so tell the agent in the prompt to decide for itself and note its choices.

## Poll a run

`GET /api/v2/ml-intern/runs/:id`

```json
{
	"id": "6733…",
	"url": "https://huggingface.co/chat/conversation/6733…",
	"status": "done",
	"spentUsd": 3.12,
	"budgetUsd": 10,
	"finalAnswer": "…"
}
```

| status    | meaning                                                | extra fields                      |
| --------- | ------------------------------------------------------ | --------------------------------- |
| `running` | the agent is generating                                |                                   |
| `waiting` | parked on a timed wait or a Job; the server resumes it | `waitReason`                      |
| `asking`  | parked on a question                                   | `question` (answer it at `url`)   |
| `done`    | the turn ended with an answer                          | `finalAnswer`                     |
| `failed`  | the turn ended on an error                             | `error`                           |
| `stopped` | stopped by the API or the UI                           | `error` when stopped while parked |

## Stop a run

`POST /api/v2/ml-intern/runs/:id/stop` stops the agent, including a parked wait or question, waits for it to wind down, and returns the run's state. Jobs it already launched keep running, as with the stop button in the UI.
