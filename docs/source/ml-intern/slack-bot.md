# ML Intern in Slack

ML Intern can work from Slack. Mention **@ML Intern** in a thread or send it a direct message, and it runs the same agent as [HuggingChat](./getting-started.md) using your own Hugging Face account. For example:

> @ML Intern take the model I linked above and create a Gradio Space for it.

## Add ML Intern to your workspace

1. Open [huggingface.co/chat/slack/install](https://huggingface.co/chat/slack/install) and click **Allow**. If your workspace requires app approval, Slack shows **Request to install** instead. Once an admin approves it, open the link again to finish.
2. After the install, ML Intern sends you a welcome DM.
3. To use it in a channel, open the channel's details, go to **Agents & apps** and add **ML Intern**.

Workspaces that only allow Slack Marketplace apps can't install ML Intern. On Enterprise Grid, install it in each workspace separately, not org-wide.

## Connect your Hugging Face account

Everyone who uses the bot connects their own Hugging Face account. Nobody shares one.

1. Mention ML Intern. The first time, it replies with a private **Connect Hugging Face** link that only you can see.
2. Sign in to Hugging Face and confirm the connection. Only confirm a link you requested yourself. The link expires after ten minutes.
3. Mention ML Intern again to start your task.

After you connect:

- **You pay for the work.** Inference and compute use your account and follow your HuggingChat [billing settings](./getting-started.md#step-3-choose-who-pays), so you can bill an organization. ML Intern publishes repositories and Spaces to your username unless you tell it otherwise.
- **Sessions appear in your HuggingChat history.** The **Open in HuggingChat** button on a thread's status card shows the full session. It's read-only there, so keep working in Slack.
- **You can bring your own MCP servers.** Tick the box when connecting, or use the toggle on [huggingface.co/chat/slack/connect](https://huggingface.co/chat/slack/connect), to give Slack sessions the MCP servers you've enabled in HuggingChat. Tool results may be posted to the thread, where everyone in it can read them.

To disconnect, go to [huggingface.co/chat/slack/connect](https://huggingface.co/chat/slack/connect). Disconnecting stops new requests but doesn't cancel runs or Jobs that are already going.

## Working with ML Intern

- **Each thread is its own session**, with its own conversation, files and compute budget. DMs are private sessions.
- **ML Intern reads the thread.** It reads your messages and attached files in the thread, up to 200 messages. It doesn't read other channels or linked threads. Attach up to 10 files per request (10 MB each, 25 MB total), for example an image to read or a CSV to work from.
- **Reply to follow up.** In a thread you started, your replies go to ML Intern without a mention. While it's working, a reply steers the current run. To post something in the thread that isn't meant for ML Intern, start the message by tagging the person or group it's for.
- **Ask side questions with `/btw`.** For example, `@ML Intern /btw which job is running?` gets a quick answer without interrupting the run, and the run never sees it.
- **Change course.** If ML Intern is waiting on a question, sending a new request skips the question and starts a new turn in the same thread.

ML Intern adds 👀 to your message when it picks up a request and ✅ when it's done.

### The status card

Each request gets a status card in the thread. The card shows whether ML Intern is working, waiting for you or done, how long the request has taken, and how much compute it has spent against its budget. Progress updates and the final result are posted below it. The card's buttons let you:

- **Stop assistant**: stop the run. Jobs it has already launched on the Hub keep running, so cancel them from your [Jobs page](https://huggingface.co/settings/jobs) if needed.
- **Retry**: rerun a request that failed or was interrupted. This can repeat compute, so check your Jobs first.
- **Download trace**: get the full conversation as a JSONL file, sent to you by DM.
- **Open in HuggingChat**: see the session, including tool calls and results.

### Questions and budgets

ML Intern sometimes asks you to choose between options before continuing. Short questions show their options as buttons in the thread: pick one for each question, then click **Submit answers**. Longer forms open with **Answer questions**. Use **Other answer** to type your own reply.

Every thread starts with a compute budget of **$0**, so ML Intern can't launch Jobs or sandboxes until you approve a budget. When it needs compute, it asks with the amount it proposes, and choosing that option approves it. The budget covers only Jobs and sandboxes. Inference is billed separately. See [Set a compute budget](./getting-started.md#step-5-set-a-compute-budget) for how budgets work.

## Sharing a thread with others

The person who first mentions ML Intern in a thread owns that session, because it runs on their Hugging Face account. In a session's thread:

- Only the owner can make requests, answer questions, approve budgets, stop or retry runs, and download the trace.
- Other people can read ML Intern's replies, but their messages and files never reach it. To use something a colleague posted, quote or paste it into your own message. To have ML Intern work on their behalf, they start their own thread.
- Everyone in the channel can read ML Intern's replies, including people from other organizations in Slack Connect channels. Keep that in mind when you ask about private repositories or data.

People from other organizations in a Slack Connect channel can use ML Intern there with their own Hugging Face accounts. Guests and bots can't use it.

## Running your own Slack bot

The bot is part of [Chat UI](https://github.com/huggingface/chat-ui), so you can also run it in your own deployment. You can run it with personal accounts like HuggingChat, or with one shared Hugging Face token for a whole company. For setup, see the [Slack integration guide](https://github.com/huggingface/chat-ui/blob/main/integrations/slack/README.md).
