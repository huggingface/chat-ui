# Getting started with ML Intern

ML Intern is a mode in [HuggingChat](https://huggingface.co/chat) that plans and runs machine-learning work for you, using the Hugging Face Hub as its workspace. Describe a task in plain language and ML Intern reads the relevant papers, models and datasets, writes the scripts, runs them on Hugging Face compute, and reports back. For example, it can:

- reproduce a paper at small scale
- finetune a model and evaluate the checkpoint
- generate or curate a dataset and push it to the Hub
- build a demo and deploy it as a Space
- run a model against a benchmark

## Before you start

You need:

- **A Hugging Face account.** Sign up at [huggingface.co](https://huggingface.co/join).
- **Credits for compute.** ML Intern runs [Hugging Face Jobs](https://huggingface.co/docs/huggingface_hub/guides/jobs) and sandboxes, billed to your Hugging Face credits or to an organization you belong to (see [Step 3](#step-3-choose-who-pays)). Chatting with the model is billed separately, as [Inference Providers](https://huggingface.co/docs/inference-providers/pricing) usage.

## Step 1: Open HuggingChat and switch on ML Intern

1. Go to [huggingface.co/chat](https://huggingface.co/chat) and sign in with your Hugging Face account.
2. In a new conversation, turn on the **ML Intern** switch under the message box. The placeholder and suggested prompts change to match.

You can also go straight to [huggingface.co/chat/?mode=ml-intern](https://huggingface.co/chat/?mode=ml-intern), which opens a new conversation with ML Intern already on. This link works well for bookmarks, or for sharing with people you're onboarding.

The mode is a property of the conversation. You can switch it on or off until you send the first message; after that it stays as it is for the rest of the conversation. To use ML Intern, start a new conversation with the switch on.

## Step 2: Enable the Hub tools ML Intern uses

ML Intern works through the [Hugging Face MCP server](https://huggingface.co/settings/mcp) and can only use the tools you have switched on there. For the best results, open your [MCP settings](https://huggingface.co/settings/mcp) and enable all of them.

The first time you turn on ML Intern, a short onboarding dialog links to this page and to your billing settings.

## Step 3: Choose who pays

By default, Jobs and sandboxes bill to your personal account. To bill an organization instead (for example, a lab, a company, or a program that gives you credits):

1. Join the organization on Hugging Face. If someone invited you, accept the invitation from your email or notifications.
2. In HuggingChat, open **Settings → Application → Billing**.
3. Choose the organization, or one of its [resource groups](https://huggingface.co/docs/hub/security-resource-groups) if the organization uses them to allocate credits. Your organization's admin can tell you which one to use.

This setting covers inference and the Jobs and sandboxes ML Intern launches. Spaces, dashboards and repositories that ML Intern creates always stay on your personal account.

## Step 4: Describe your task

Write what you want done, as specifically as you can. Links and Hub ids help: type `@` to mention a model, dataset or Space by its id, and paste paper URLs directly. Some examples:

- `Reproduce <paper title> (https://huggingface.co/papers/<id>) at small scale and report where the results diverge.`
- `Finetune @<model-id> on @<dataset-id> and evaluate the checkpoint.`
- `Build a Gradio demo Space for @<model-id>.`
- `Generate a synthetic function-calling dataset and push it to the Hub.`
- `Evaluate @<model-id> on @<benchmark-dataset-id> and score it.`

The suggested prompts above the message box show worked versions of each. ML Intern plans the work first, then carries it out step by step. A progress row above the message box shows where it is in the plan.

## Step 5: Set a compute budget

Every ML Intern conversation has its own **compute budget**, which caps what that conversation can spend on Jobs and sandboxes. It starts at **$0**, so ML Intern can't launch any compute until you give it a budget.

Once the conversation starts, the budget appears in the status bar above the message box. Click it to set or change the amount. Each launch reserves its worst-case cost (the hardware's price times the job's timeout), then settles to what it actually used when it finishes.

Two other limits also apply:

- **Your credit balance** is the ceiling account-wide: Jobs stop when it runs out.
- **Organizations** can also set a spend limit on a resource group.

The compute budget only covers Jobs and sandboxes that ML Intern launches. It doesn't cover chatting with the model, anything those Jobs start themselves, or other Hugging Face products.

## Following along

While ML Intern works, you can:

- **Open "Resources"** from the status bar to see everything the conversation has created:
  - running and finished Jobs and sandboxes
  - repositories and Spaces it pushed to
  - the scripts it wrote, with every version and the Jobs that ran each one
  - the images its tools returned, such as sample grids and plots
- **Watch training live.** When a training run logs to [Trackio](https://huggingface.co/docs/trackio), a live metrics dashboard opens in a side panel.
- **Answer its questions.** ML Intern sometimes asks you to choose between options or confirm a step before it continues.
- **Resume after a failure.** If a turn fails partway, use **Resume** to continue from where it stopped rather than starting the whole turn again.

## Using your credits outside ML Intern

The same credits and billing work when you use Hugging Face compute directly. For an organization's resource group, pass its namespace and resource group id.

Run a Job from the [`hf` CLI](https://huggingface.co/docs/huggingface_hub/guides/cli):

```bash
hf jobs run --namespace <org-name> --resource-group-id <resource-group-id> python:3.12 python -c "print('Hello!')"
```

Or from Python:

```python
from huggingface_hub import run_job

run_job(
    image="python:3.12",
    command=["python", "-c", "print('Hello!')"],
    namespace="<org-name>",
    resource_group_id="<resource-group-id>",
)
```

Call [Inference Providers](https://huggingface.co/docs/inference-providers) billed to the same group with `bill_to`:

```python
from huggingface_hub import InferenceClient

client = InferenceClient(bill_to="<resource-group-id>")
completion = client.chat.completions.create(
    model="deepseek-ai/DeepSeek-V3-0324",
    messages=[{"role": "user", "content": "How many 'G's in 'huggingface'?"}],
)
print(completion.choices[0].message)
```

## Running ML Intern yourself

ML Intern is part of Chat UI, the open-source app behind HuggingChat. To run it locally or work on it, see [Running Chat UI with ML Intern locally](./local-development.md).
