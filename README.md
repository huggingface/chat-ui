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

And add this to your `.env.local`:

```
MODELS=`[{"name": "...", "endpoints": [{"url": "127.0.0.1:8080/generate_stream"}]}]`
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://kit.svelte.dev/docs/adapters) for your target environment.
