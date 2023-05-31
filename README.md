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

1. [Setup](#setup)
2. [Launch](#launch)
3. [Extra parameters](#extra-parameters)
4. [Deploying to a HF Space](#deploying-to-a-hf-space)
5. [Building](#building)

## Setup

The default config for Chat UI is stored in the `.env` file. You will need to override some values to get Chat UI to run locally. This is done in `.env.local`.

Start by creating a `.env.local` file in the root of the repository. The bare minimum config you need to get Chat UI to run locally is the following:

```bash
MONGODB_URL=<the URL to your mongoDB instance>
HF_ACCESS_TOKEN=<your access token>
```

### Database

The chat history is stored in a MongoDB instance, and having a DB instance available is needed for Chat UI to work.

You can use a local MongoDB instance. The easiest way is to spin one up is using docker:

```bash
docker run -d -p 27017:27017 --name mongo-chatui mongo:latest
```

In which case the url of your DB will be `MONGODB_URL=mongodb://localhost:27017`.

Alternatively, you can use a [free MongoDB Atlas](https://www.mongodb.com/pricing) instance for this, Chat UI should fit comfortably within the free tier. After which you can set the `MONGODB_URL` variable in `.env.local` to match your instance.

### Hugging Face Access Token

You will need a Hugging Face access token to run Chat UI locally, using the remote inference endpoints. You can get one from [your Hugging Face profile](https://huggingface.co/settings/tokens).

## Launch

After you're done with the `.env.local` file you can run Chat UI locally with:

```bash
npm install
npm run dev
```

## Extra parameters

### OpenID connect

The login feature is disabled by default and users are attributed a unique ID based on their browser. But if you want to use OpenID to authenticate your users, you can add the following to your `.env.local` file:

```bash
OPENID_PROVIDER_URL=<your OIDC issuer>
OPENID_CLIENT_ID=<your OIDC client ID>
OPENID_CLIENT_SECRET=<your OIDC client secret>
```

These variables will enable the openID sign-in modal for users.

### Custom models

You can customize the parameters passed to the model or even use a new model by updating the `MODELS` variable in your `.env.local`. The default one can be found in `.env` and looks like this :

```json
MODELS=`[
  {
    "name": "OpenAssistant/oasst-sft-4-pythia-12b-epoch-3.5",
    "datasetName": "OpenAssistant/oasst1",
    "description": "A good alternative to ChatGPT",
    "websiteUrl": "https://open-assistant.io",
    "userMessageToken": "<|prompter|>",
    "assistantMessageToken": "<|assistant|>",
    "messageEndToken": "</s>",
    "preprompt": "Below are a series of dialogues between various people and an AI assistant. The AI tries to be helpful, polite, honest, sophisticated, emotionally aware, and humble-but-knowledgeable. The assistant is happy to help with almost anything, and will do its best to understand exactly what is needed. It also tries to avoid giving false or misleading information, and it caveats when it isn't entirely sure about the right answer. That said, the assistant is practical and really does its best, and doesn't let caution get too much in the way of being useful.\n-----\n",
    "promptExamples": [
      {
        "title": "Write an email from bullet list",
        "prompt": "As a restaurant owner, write a professional email to the supplier to get these products every week: \n\n- Wine (x10)\n- Eggs (x24)\n- Bread (x12)"
      }, {
        "title": "Code a snake game",
        "prompt": "Code a basic snake game in python, give explanations for each step."
      }, {
        "title": "Assist in a task",
        "prompt": "How do I make a delicious lemon cheesecake?"
      }
    ],
    "parameters": {
      "temperature": 0.9,
      "top_p": 0.95,
      "repetition_penalty": 1.2,
      "top_k": 50,
      "truncate": 1000,
      "max_new_tokens": 1024
    }
  }
]`
```

You can change things like the parameters, or customize the preprompt to better suit your needs. You can also add more models by adding more objects to the array, with different preprompts for example.

### Running your own models

If you want to, you can even run your own models, by having a look at our endpoint project, [text-generation-inference](https://github.com/huggingface/text-generation-inference). You can then add your own endpoint to the `MODELS` variable in `.env.local` and it will be picked up as well.

## Deploying to a HF Space

Create a `DOTENV_LOCAL` secret to your HF space with the content of your .env.local, and they will be picked up automatically when you run.

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://kit.svelte.dev/docs/adapters) for your target environment.
