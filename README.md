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

![Chat UI repository thumbnail](https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chatui-websearch.png)

A chat interface using open source models, eg OpenAssistant or Llama. It is a SvelteKit app and it powers the [HuggingChat app on hf.co/chat](https://huggingface.co/chat).

0. [No Setup Deploy](#no-setup-deploy)
1. [Setup](#setup)
2. [Launch](#launch)
3. [Web Search](#web-search)
4. [Extra parameters](#extra-parameters)
5. [Deploying to a HF Space](#deploying-to-a-hf-space)
6. [Building](#building)

##  No Setup Deploy

If you don't want to configure, setup, and launch your own Chat UI yourself, you can use this option as a fast deploy alternative.

You can deploy your own customized Chat UI instance with any supported [LLM](https://huggingface.co/models?pipeline_tag=text-generation&sort=trending) of your choice on [Hugging Face Spaces](https://huggingface.co/spaces). To do so, use the chat-ui template [available here](https://huggingface.co/new-space?template=huggingchat/chat-ui-template).

Set `HUGGING_FACE_HUB_TOKEN` in [Space secrets](https://huggingface.co/docs/hub/spaces-overview#managing-secrets-and-environment-variables) to deploy a model with gated access or a model in a private repository. It's also compatible with [Inference for PROs](https://huggingface.co/blog/inference-pro) curated list of powerful models with higher rate limits. Make sure to create your personal token first in your [User Access Tokens settings](https://huggingface.co/settings/tokens).

Read the full tutorial [here](https://huggingface.co/docs/hub/spaces-sdks-docker-chatui#chatui-on-spaces).

## Setup

The default config for Chat UI is stored in the `.env` file. You will need to override some values to get Chat UI to run locally. This is done in `.env.local`.

Start by creating a `.env.local` file in the root of the repository. The bare minimum config you need to get Chat UI to run locally is the following:

```env
MONGODB_URL=<the URL to your MongoDB instance>
HF_ACCESS_TOKEN=<your access token>
```

### Database

The chat history is stored in a MongoDB instance, and having a DB instance available is needed for Chat UI to work.

You can use a local MongoDB instance. The easiest way is to spin one up using docker:

```bash
docker run -d -p 27017:27017 --name mongo-chatui mongo:latest
```

In which case the url of your DB will be `MONGODB_URL=mongodb://localhost:27017`.

Alternatively, you can use a [free MongoDB Atlas](https://www.mongodb.com/pricing) instance for this, Chat UI should fit comfortably within their free tier. After which you can set the `MONGODB_URL` variable in `.env.local` to match your instance.

### Hugging Face Access Token

If you use a remote inference endpoint, you will need a Hugging Face access token to run Chat UI locally. You can get one from [your Hugging Face profile](https://huggingface.co/settings/tokens).

## Launch

After you're done with the `.env.local` file you can run Chat UI locally with:

```bash
npm install
npm run dev
```

## Web Search

Chat UI features a powerful Web Search feature. It works by:

1. Generating an appropriate search query from the user prompt.
2. Performing web search and extracting content from webpages.
3. Creating embeddings from texts using [transformers.js](https://huggingface.co/docs/transformers.js). Specifically, using [Xenova/gte-small](https://huggingface.co/Xenova/gte-small) model.
4. From these embeddings, find the ones that are closest to the user query using a vector similarity search. Specifically, we use `inner product` distance.
5. Get the corresponding texts to those closest embeddings and perform [Retrieval-Augmented Generation](https://huggingface.co/papers/2005.11401) (i.e. expand user prompt by adding those texts so that an LLM can use this information).

## Extra parameters

### OpenID connect

The login feature is disabled by default and users are attributed a unique ID based on their browser. But if you want to use OpenID to authenticate your users, you can add the following to your `.env.local` file:

```env
OPENID_CONFIG=`{
  PROVIDER_URL: "<your OIDC issuer>",
  CLIENT_ID: "<your OIDC client ID>",
  CLIENT_SECRET: "<your OIDC client secret>",
  SCOPES: "openid profile",
  TOLERANCE: // optional
  RESOURCE: // optional
}`
```

These variables will enable the openID sign-in modal for users.

### Theming

You can use a few environment variables to customize the look and feel of chat-ui. These are by default:

```env
PUBLIC_APP_NAME=ChatUI
PUBLIC_APP_ASSETS=chatui
PUBLIC_APP_COLOR=blue
PUBLIC_APP_DESCRIPTION="Making the community's best AI chat models available to everyone."
PUBLIC_APP_DATA_SHARING=
PUBLIC_APP_DISCLAIMER=
```

- `PUBLIC_APP_NAME` The name used as a title throughout the app.
- `PUBLIC_APP_ASSETS` Is used to find logos & favicons in `static/$PUBLIC_APP_ASSETS`, current options are `chatui` and `huggingchat`.
- `PUBLIC_APP_COLOR` Can be any of the [tailwind colors](https://tailwindcss.com/docs/customizing-colors#default-color-palette).
- `PUBLIC_APP_DATA_SHARING` Can be set to 1 to add a toggle in the user settings that lets your users opt-in to data sharing with models creator.
- `PUBLIC_APP_DISCLAIMER` If set to 1, we show a disclaimer about generated outputs on login.

### Web Search config

You can enable the web search by adding any of `YDC_API_KEY` ([docs.you.com](https://docs.you.com)) or `SERPER_API_KEY` ([serper.dev](https://serper.dev/)) or `SERPAPI_KEY` ([serpapi.com](https://serpapi.com/)) to your `.env.local`.

### Custom models

You can customize the parameters passed to the model or even use a new model by updating the `MODELS` variable in your `.env.local`. The default one can be found in `.env` and looks like this :

```env
MODELS=`[
  {
    "name": "OpenAssistant/oasst-sft-4-pythia-12b-epoch-3.5",
    "datasetName": "OpenAssistant/oasst1",
    "description": "A good alternative to ChatGPT",
    "websiteUrl": "https://open-assistant.io",
    "userMessageToken": "<|prompter|>", # This does not need to be a token, can be any string
    "assistantMessageToken": "<|assistant|>", # This does not need to be a token, can be any string
    "userMessageEndToken": "<|endoftext|>", # Applies only to user messages. Can be any string.
    "assistantMessageEndToken": "<|endoftext|>", # Applies only to assistant messages. Can be any string.
    "preprompt": "Below are a series of dialogues between various people and an AI assistant. The AI tries to be helpful, polite, honest, sophisticated, emotionally aware, and humble but knowledgeable. The assistant is happy to help with almost anything and will do its best to understand exactly what is needed. It also tries to avoid giving false or misleading information, and it caveats when it isn't entirely sure about the right answer. That said, the assistant is practical and really does its best, and doesn't let caution get too much in the way of being useful.\n-----\n",
    "promptExamples": [
      {
        "title": "Write an email from bullet list",
        "prompt": "As a restaurant owner, write a professional email to the supplier to get these products every week: \n\n- Wine (x10)\n- Eggs (x24)\n- Bread (x12)"
      }, {
        "title": "Code a snake game",
        "prompt": "Code a basic snake game in python and give explanations for each step."
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
      "max_new_tokens": 1024,
      "stop": ["<|endoftext|>"]  # This does not need to be tokens, can be any list of strings
    }
  }
]`

```

You can change things like the parameters, or customize the preprompt to better suit your needs. You can also add more models by adding more objects to the array, with different preprompts for example.

#### chatPromptTemplate

When querying the model for a chat response, the `chatPromptTemplate` template is used. `messages` is an array of chat messages, it has the format `[{ content: string }, ...]`. To identify if a message is a user message or an assistant message the `ifUser` and `ifAssistant` block helpers can be used.

The following is the default `chatPromptTemplate`, although newlines and indentiation have been added for readability. You can find the prompts used in production for HuggingChat [here](https://github.com/huggingface/chat-ui/blob/main/PROMPTS.md).

```prompt
{{preprompt}}
{{#each messages}}
  {{#ifUser}}{{@root.userMessageToken}}{{content}}{{@root.userMessageEndToken}}{{/ifUser}}
  {{#ifAssistant}}{{@root.assistantMessageToken}}{{content}}{{@root.assistantMessageEndToken}}{{/ifAssistant}}
{{/each}}
{{assistantMessageToken}}
```

#### Multi modal model

We currently only support IDEFICS as a multimodal model, hosted on TGI. You can enable it by using the followin config (if you have a PRO HF Api token):

```env
    {
      "name": "HuggingFaceM4/idefics-80b-instruct",
      "multimodal" : true,
      "description": "IDEFICS is the new multimodal model by Hugging Face.",
      "preprompt": "",
      "chatPromptTemplate" : "{{#each messages}}{{#ifUser}}User: {{content}}{{/ifUser}}<end_of_utterance>\nAssistant: {{#ifAssistant}}{{content}}\n{{/ifAssistant}}{{/each}}",
      "parameters": {
        "temperature": 0.1,
        "top_p": 0.95,
        "repetition_penalty": 1.2,
        "top_k": 12,
        "truncate": 1000,
        "max_new_tokens": 1024,
        "stop": ["<end_of_utterance>", "User:", "\nUser:"]
      }
    }
```

#### Running your own models using a custom endpoint

If you want to, instead of hitting models on the Hugging Face Inference API, you can run your own models locally.

A good option is to hit a [text-generation-inference](https://github.com/huggingface/text-generation-inference) endpoint. This is what is done in the official [Chat UI Spaces Docker template](https://huggingface.co/new-space?template=huggingchat/chat-ui-template) for instance: both this app and a text-generation-inference server run inside the same container.

To do this, you can add your own endpoints to the `MODELS` variable in `.env.local`, by adding an `"endpoints"` key for each model in `MODELS`.

```env
{
// rest of the model config here
"endpoints": [{
  "type" : "tgi",
  "url": "https://HOST:PORT",
  }]
}
```

If `endpoints` are left unspecified, ChatUI will look for the model on the hosted Hugging Face inference API using the model name.

##### OpenAI API compatible models

Chat UI can be used with any API server that supports OpenAI API compatibility, for example [text-generation-webui](https://github.com/oobabooga/text-generation-webui/tree/main/extensions/openai), [LocalAI](https://github.com/go-skynet/LocalAI), [FastChat](https://github.com/lm-sys/FastChat/blob/main/docs/openai_api.md), [llama-cpp-python](https://github.com/abetlen/llama-cpp-python), and [ialacol](https://github.com/chenhunghan/ialacol).

The following example config makes Chat UI works with [text-generation-webui](https://github.com/oobabooga/text-generation-webui/tree/main/extensions/openai), the `endpoint.baseUrl` is the url of the OpenAI API compatible server, this overrides the baseUrl to be used by OpenAI instance. The `endpoint.completion` determine which endpoint to be used, default is `chat_completions` which uses `v1/chat/completions`, change to `endpoint.completion` to `completions` to use the `v1/completions` endpoint.

```
MODELS=`[
  {
    "name": "text-generation-webui",
    "id": "text-generation-webui",
    "parameters": {
      "temperature": 0.9,
      "top_p": 0.95,
      "repetition_penalty": 1.2,
      "top_k": 50,
      "truncate": 1000,
      "max_new_tokens": 1024,
      "stop": []
    },
    "endpoints": [{
      "type" : "openai",
      "baseURL": "http://localhost:8000/v1"
    }]
  }
]`

```

The `openai` type includes official OpenAI models. You can add, for example, GPT4/GPT3.5 as a "openai" model:

```
OPENAI_API_KEY=#your openai api key here
MODELS=`[{
      "name": "gpt-4",
      "displayName": "GPT 4",
      "endpoints" : [{
        "type": "openai"
      }]
},
      {
      "name": "gpt-3.5-turbo",
      "displayName": "GPT 3.5 Turbo",
      "endpoints" : [{
        "type": "openai"
      }]
}]`
```

##### Llama.cpp API server

chat-ui also supports the llama.cpp API server directly without the need for an adapter. You can do this using the `llamacpp` endpoint type.

If you want to run chat-ui with llama.cpp, you can do the following, using Zephyr as an example model:

1. Get [the weights](https://huggingface.co/TheBloke/zephyr-7B-beta-GGUF/tree/main) from the hub
2. Run the server with the following command: `./server -m models/zephyr-7b-beta.Q4_K_M.gguf -c 2048 -np 3`
3. Add the following to your `.env.local`:

```env
MODELS=[
  {
      "name": "Local Zephyr",
      "chatPromptTemplate": "<|system|>\n{{preprompt}}</s>\n{{#each messages}}{{#ifUser}}<|user|>\n{{content}}</s>\n<|assistant|>\n{{/ifUser}}{{#ifAssistant}}{{content}}</s>\n{{/ifAssistant}}{{/each}}",
      "parameters": {
        "temperature": 0.1,
        "top_p": 0.95,
        "repetition_penalty": 1.2,
        "top_k": 50,
        "truncate": 1000,
        "max_new_tokens": 2048,
        "stop": ["</s>"]
      },
      "endpoints": [
        {
         "url": "http://127.0.0.1:8080",
         "type": "llamacpp"
        }
      ]
  }
]
```

Start chat-ui with `npm run dev` and you should be able to chat with Zephyr locally.

#### Amazon

You can also specify your Amazon SageMaker instance as an endpoint for chat-ui. The config goes like this:

```env
"endpoints": [
    {
      "type" : "aws",
      "service" : "sagemaker"
      "url": "",
      "accessKey": "",
      "secretKey" : "",
      "sessionToken": "",
      "region": "",

      "weight": 1
    }
]
```

You can also set `"service" : "lambda"` to use a lambda instance.

You can get the `accessKey` and `secretKey` from your AWS user, under programmatic access.

### Custom endpoint authorization

#### Basic and Bearer

Custom endpoints may require authorization, depending on how you configure them. Authentication will usually be set either with `Basic` or `Bearer`.

For `Basic` we will need to generate a base64 encoding of the username and password.

`echo -n "USER:PASS" | base64`

> VVNFUjpQQVNT

For `Bearer` you can use a token, which can be grabbed from [here](https://huggingface.co/settings/tokens).

You can then add the generated information and the `authorization` parameter to your `.env.local`.

```env
"endpoints": [
{
"url": "https://HOST:PORT",
"authorization": "Basic VVNFUjpQQVNT",
}
]
```

#### Models hosted on multiple custom endpoints

If the model being hosted will be available on multiple servers/instances add the `weight` parameter to your `.env.local`. The `weight` will be used to determine the probability of requesting a particular endpoint.

```env
"endpoints": [
{
"url": "https://HOST:PORT",
"weight": 1
}
{
"url": "https://HOST:PORT",
"weight": 2
}
...
]
```

#### Client Certificate Authentication (mTLS)

Custom endpoints may require client certificate authentication, depending on how you configure them. To enable mTLS between Chat UI and your custom endpoint, you will need to set the `USE_CLIENT_CERTIFICATE` to `true`, and add the `CERT_PATH` and `KEY_PATH` parameters to your `.env.local`. These parameters should point to the location of the certificate and key files on your local machine. The certificate and key files should be in PEM format. The key file can be encrypted with a passphrase, in which case you will also need to add the `CLIENT_KEY_PASSWORD` parameter to your `.env.local`.

If you're using a certificate signed by a private CA, you will also need to add the `CA_PATH` parameter to your `.env.local`. This parameter should point to the location of the CA certificate file on your local machine.

If you're using a self-signed certificate, e.g. for testing or development purposes, you can set the `REJECT_UNAUTHORIZED` parameter to `false` in your `.env.local`. This will disable certificate validation, and allow Chat UI to connect to your custom endpoint.

## Deploying to a HF Space

Create a `DOTENV_LOCAL` secret to your HF space with the content of your .env.local, and they will be picked up automatically when you run.

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://kit.svelte.dev/docs/adapters) for your target environment.
