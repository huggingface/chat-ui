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

A chat interface using open source models, eg OpenAssistant.

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
MODEL_ENDPOINTS=`[{
  "endpoint": "https://api-inference.huggingface.co/models/OpenAssistant/oasst-sft-4-pythia-12b-epoch-3.5",
  "authorization": "Bearer <hf_token>",
  "weight": 1
}]`
```

Where the contents in `<...>` are replaced by the MongoDB URL and your [HF Access Token](https://huggingface.co/settings/tokens).

## Duplicating to a Space

Create a `DOTENV_LOCAL` secret to your space with the following contents:

```
MONGODB_URL=<url to mongo, for example a free MongoDB Atlas sandbox instance>
MODEL_ENDPOINTS=`[{
  "endpoint": "https://api-inference.huggingface.co/models/OpenAssistant/oasst-sft-4-pythia-12b-epoch-3.5",
  "authorization": "Bearer <hf_token>",
  "weight": 1
}]`
```

Where the contents in `<...>` are replaced by the MongoDB URL and your [HF Access Token](https://huggingface.co/settings/tokens).

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://kit.svelte.dev/docs/adapters) for your target environment.
