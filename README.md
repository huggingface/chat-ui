---
title: chat-ui
emoji: 🔥
colorFrom: purple
colorTo: purple
sdk: docker
pinned: false
license: apache-2.0
base_path: /chat
app_port: 3000
---

# Chat UI

![Chat UI repository thumbnail](https://huggingface.co/datasets/huggingface/documentation-images/raw/f038917dd40d711a72d654ab1abfc03ae9f177e6/chat-ui-repo-thumbnail.svg)

A chat interface using open source models, eg OpenAssistant. It is a SvelteKit app and it powers the [HuggingChat app on hf.co/chat](https://huggingface.co/chat).

## Launch

```bash
npm install
npm run dev
```

## Environment

Default configuration is in `.env`. Put custom config and secrets in `.env.local`, it will override the values in `.env`.

Check out [.env](./.env) to see what needs to be set.

Basically you need to create a `.env.local` with the following contents:

```
MONGODB_URL=<url to mongo, for example a free MongoDB Atlas sandbox instance>
HF_ACCESS_TOKEN=<your HF access token from https://huggingface.co/settings/tokens>
```

## Duplicating to a Space

Create a `DOTENV_LOCAL` secret to your space with the following contents:

```
MONGODB_URL=<url to mongo, for example a free MongoDB Atlas sandbox instance>
HF_ACCESS_TOKEN=<your HF access token from https://huggingface.co/settings/tokens>
```

Where the contents in `<...>` are replaced by the MongoDB URL and your [HF Access Token](https://huggingface.co/settings/tokens).

## Running Local Inference

Both the example above use the HF Inference API or HF Endpoints API.

If you want to run the model locally, you need to run this inference server locally: https://github.com/huggingface/text-generation-inference

And add this to your `.env.local`, feel free to adjust/remove the parameters and the preprompt:

```
MODELS=`[{
  "name": "...",
  "endpoints": [{"url": "http://127.0.0.1:8080/generate_stream"}],
  "userMessageToken": "<|prompter|>",
  "assistantMessageToken": "<|assistant|>",
  "messageEndToken": "</s>",
  "preprompt": "Below are a series of dialogues between various people and an AI assistant. The AI tries to be helpful, polite, honest, sophisticated, emotionally aware, and humble-but-knowledgeable. The assistant is happy to help with almost anything, and will do its best to understand exactly what is needed. It also tries to avoid giving false or misleading information, and it caveats when it isn't entirely sure about the right answer. That said, the assistant is practical and really does its best, and doesn't let caution get too much in the way of being useful.\n-----\n",
  "parameters": {
    "temperature": 0.9,
    "top_p": 0.95,
    "repetition_penalty": 1.2,
    "top_k": 50,
    "truncate": 1000,
    "max_new_tokens": 1000
  }
}]`
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://kit.svelte.dev/docs/adapters) for your target environment.
