# Chat UI

**Find the docs at [hf.co/docs/chat-ui](https://huggingface.co/docs/chat-ui/index).**

![Chat UI repository thumbnail](https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chatui-websearch.png)

A chat interface using open source models, eg OpenAssistant or Llama. It is a SvelteKit app and it powers the [HuggingChat app on hf.co/chat](https://huggingface.co/chat).

0. [Quickstart](#quickstart)
1. [No Setup Deploy](#no-setup-deploy)
2. [Setup](#setup)
3. [Launch](#launch)
4. [Web Search](#web-search)
5. [Text Embedding Models](#text-embedding-models)
6. [Extra parameters](#extra-parameters)
7. [Common issues](#common-issues)
8. [Deploying to a HF Space](#deploying-to-a-hf-space)
9. [Building](#building)

## Quickstart

You can quickly start a locally running chat-ui & LLM text-generation server thanks to chat-ui's [llama.cpp server support](https://huggingface.co/docs/chat-ui/configuration/models/providers/llamacpp).

**Step 1 (Start llama.cpp server):**

Install llama.cpp w/ brew (for Mac):

```bash
# install llama.cpp
brew install llama.cpp
```

or [build directly from the source](https://github.com/ggerganov/llama.cpp/blob/master/docs/build.md) for your target device:

```
git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp && make
```

Next, start the server with the [LLM of your choice](https://huggingface.co/models?library=gguf):

```bash
# start llama.cpp server (using hf.co/microsoft/Phi-3-mini-4k-instruct-gguf as an example)
llama-server --hf-repo microsoft/Phi-3-mini-4k-instruct-gguf --hf-file Phi-3-mini-4k-instruct-q4.gguf -c 4096
```

A local LLaMA.cpp HTTP Server will start on `http://localhost:8080`. Read more [here](https://huggingface.co/docs/chat-ui/configuration/models/providers/llamacpp).

**Step 2 (tell chat-ui to use local llama.cpp server):**

Add the following to your `.env.local`:

```ini
MODELS=`[
  {
    "name": "Local microsoft/Phi-3-mini-4k-instruct-gguf",
    "tokenizer": "microsoft/Phi-3-mini-4k-instruct-gguf",
    "preprompt": "",
    "parameters": {
      "stop": ["<|end|>", "<|endoftext|>", "<|assistant|>"],
      "temperature": 0.7,
      "max_new_tokens": 1024,
      "truncate": 3071
    },
    "endpoints": [{
      "type" : "llamacpp",
      "baseURL": "http://localhost:8080"
    }],
  },
]`
```

The `tokenizer` field will be used to find the appropriate chat template for the model. Make sure to fill in a valid model from the Hugging Face hub.

Read more [here](https://huggingface.co/docs/chat-ui/configuration/models/providers/llamacpp).

**Step 3 (make sure you have MongoDb running locally):**

```bash
docker run -d -p 27017:27017 --name mongo-chatui mongo:latest
```

Read more [here](#database).

**Step 4 (start chat-ui):**

```bash
git clone https://github.com/huggingface/chat-ui
cd chat-ui
npm install
npm run dev -- --open
```

Read more [here](#launch).

<img class="hidden dark:block" src="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chat-ui/llamacpp-dark.png" height="auto"/>

## No Setup Deploy

If you don't want to configure, setup, and launch your own Chat UI yourself, you can use this option as a fast deploy alternative.

You can deploy your own customized Chat UI instance with any supported [LLM](https://huggingface.co/models?pipeline_tag=text-generation&sort=trending) of your choice on [Hugging Face Spaces](https://huggingface.co/spaces). To do so, use the chat-ui template [available here](https://huggingface.co/new-space?template=huggingchat/chat-ui-template).

Set `HF_TOKEN` in [Space secrets](https://huggingface.co/docs/hub/spaces-overview#managing-secrets-and-environment-variables) to deploy a model with gated access or a model in a private repository. It's also compatible with [Inference for PROs](https://huggingface.co/blog/inference-pro) curated list of powerful models with higher rate limits. Make sure to create your personal token first in your [User Access Tokens settings](https://huggingface.co/settings/tokens).

Read the full tutorial [here](https://huggingface.co/docs/hub/spaces-sdks-docker-chatui#chatui-on-spaces).

## Setup

The default config for Chat UI is stored in the `.env` file. You will need to override some values to get Chat UI to run locally. This is done in `.env.local`.

Start by creating a `.env.local` file in the root of the repository. The bare minimum config you need to get Chat UI to run locally is the following:

```env
MONGODB_URL=<the URL to your MongoDB instance>
HF_TOKEN=<your access token>
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
3. Creating embeddings from texts using a text embedding model.
4. From these embeddings, find the ones that are closest to the user query using a vector similarity search. Specifically, we use `inner product` distance.
5. Get the corresponding texts to those closest embeddings and perform [Retrieval-Augmented Generation](https://huggingface.co/papers/2005.11401) (i.e. expand user prompt by adding those texts so that an LLM can use this information).

## Text Embedding Models

By default (for backward compatibility), when `TEXT_EMBEDDING_MODELS` environment variable is not defined, [transformers.js](https://huggingface.co/docs/transformers.js) embedding models will be used for embedding tasks, specifically, [Xenova/gte-small](https://huggingface.co/Xenova/gte-small) model.

You can customize the embedding model by setting `TEXT_EMBEDDING_MODELS` in your `.env.local` file. For example:

```env
TEXT_EMBEDDING_MODELS = `[
  {
    "name": "Xenova/gte-small",
    "displayName": "Xenova/gte-small",
    "description": "locally running embedding",
    "chunkCharLength": 512,
    "endpoints": [
      {"type": "transformersjs"}
    ]
  },
  {
    "name": "intfloat/e5-base-v2",
    "displayName": "intfloat/e5-base-v2",
    "description": "hosted embedding model",
    "chunkCharLength": 768,
    "preQuery": "query: ", # See https://huggingface.co/intfloat/e5-base-v2#faq
    "prePassage": "passage: ", # See https://huggingface.co/intfloat/e5-base-v2#faq
    "endpoints": [
      {
        "type": "tei",
        "url": "http://127.0.0.1:8080/",
        "authorization": "TOKEN_TYPE TOKEN" // optional authorization field. Example: "Basic VVNFUjpQQVNT"
      }
    ]
  }
]`
```

The required fields are `name`, `chunkCharLength` and `endpoints`.
Supported text embedding backends are: [`transformers.js`](https://huggingface.co/docs/transformers.js), [`TEI`](https://github.com/huggingface/text-embeddings-inference) and [`OpenAI`](https://platform.openai.com/docs/guides/embeddings). `transformers.js` models run locally as part of `chat-ui`, whereas `TEI` models run in a different environment & accessed through an API endpoint. `openai` models are accessed through the [OpenAI API](https://platform.openai.com/docs/guides/embeddings).

When more than one embedding models are supplied in `.env.local` file, the first will be used by default, and the others will only be used on LLM's which configured `embeddingModel` to the name of the model.

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

### Trusted header authentication

You can set the env variable `TRUSTED_EMAIL_HEADER` to point to the header that contains the user's email address. This will allow you to authenticate users from the header. This setup is usually combined with a proxy that will be in front of chat-ui and will handle the auth and set the header.

> [!WARNING]
> Make sure to only allow requests to chat-ui through your proxy which handles authentication, otherwise users could authenticate as anyone by setting the header manually! Only set this up if you understand the implications and know how to do it correctly.

Here is a list of header names for common auth providers:

- Tailscale Serve: `Tailscale-User-Login`
- Cloudflare Access: `Cf-Access-Authenticated-User-Email`
- oauth2-proxy: `X-Forwarded-Email`

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

You can enable the web search through an API by adding `YDC_API_KEY` ([docs.you.com](https://docs.you.com)) or `SERPER_API_KEY` ([serper.dev](https://serper.dev/)) or `SERPAPI_KEY` ([serpapi.com](https://serpapi.com/)) or `SERPSTACK_API_KEY` ([serpstack.com](https://serpstack.com/)) or `SEARCHAPI_KEY` ([searchapi.io](https://www.searchapi.io/)) to your `.env.local`.

You can also simply enable the local google websearch by setting `USE_LOCAL_WEBSEARCH=true` in your `.env.local` or specify a SearXNG instance by adding the query URL to `SEARXNG_QUERY_URL`.

You can enable javascript when parsing webpages to improve compatibility with `WEBSEARCH_JAVASCRIPT=true` at the cost of increased CPU usage. You'll want at least 4 cores when enabling.

### Custom models

You can customize the parameters passed to the model or even use a new model by updating the `MODELS` variable in your `.env.local`. The default one can be found in `.env` and looks like this :

```env
MODELS=`[
  {
    "name": "mistralai/Mistral-7B-Instruct-v0.2",
    "displayName": "mistralai/Mistral-7B-Instruct-v0.2",
    "description": "Mistral 7B is a new Apache 2.0 model, released by Mistral AI that outperforms Llama2 13B in benchmarks.",
    "websiteUrl": "https://mistral.ai/news/announcing-mistral-7b/",
    "preprompt": "",
    "chatPromptTemplate" : "<s>{{#each messages}}{{#ifUser}}[INST] {{#if @first}}{{#if @root.preprompt}}{{@root.preprompt}}\n{{/if}}{{/if}}{{content}} [/INST]{{/ifUser}}{{#ifAssistant}}{{content}}</s>{{/ifAssistant}}{{/each}}",
    "parameters": {
      "temperature": 0.3,
      "top_p": 0.95,
      "repetition_penalty": 1.2,
      "top_k": 50,
      "truncate": 3072,
      "max_new_tokens": 1024,
      "stop": ["</s>"]
    },
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
    ]
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

We currently support [IDEFICS](https://huggingface.co/blog/idefics) (hosted on TGI), OpenAI and Claude 3 as multimodal models. You can enable it by setting `multimodal: true` in your `MODELS` configuration. For IDEFICS, you must have a [PRO HF Api token](https://huggingface.co/settings/tokens). For OpenAI, see the [OpenAI section](#OpenAI). For Anthropic, see the [Anthropic section](#anthropic).

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

Chat UI can be used with any API server that supports OpenAI API compatibility, for example [text-generation-webui](https://github.com/oobabooga/text-generation-webui/tree/main/extensions/openai), [LocalAI](https://github.com/go-skynet/LocalAI), [FastChat](https://github.com/lm-sys/FastChat/blob/main/docs/openai_api.md), [llama-cpp-python](https://github.com/abetlen/llama-cpp-python), and [ialacol](https://github.com/chenhunghan/ialacol) and [vllm](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html).

The following example config makes Chat UI works with [text-generation-webui](https://github.com/oobabooga/text-generation-webui/tree/main/extensions/openai), the `endpoint.baseUrl` is the url of the OpenAI API compatible server, this overrides the baseUrl to be used by OpenAI instance. The `endpoint.completion` determine which endpoint to be used, default is `chat_completions` which uses `v1/chat/completions`, change to `endpoint.completion` to `completions` to use the `v1/completions` endpoint.

Parameters not supported by OpenAI (e.g., top_k, repetition_penalty, etc.) must be set in the extraBody of endpoints. Be aware that setting them in parameters will cause them to be omitted.

```
MODELS=`[
  {
    "name": "text-generation-webui",
    "id": "text-generation-webui",
    "parameters": {
      "temperature": 0.9,
      "top_p": 0.95,
      "max_new_tokens": 1024,
      "stop": []
    },
    "endpoints": [{
      "type" : "openai",
      "baseURL": "http://localhost:8000/v1",
      "extraBody": {
        "repetition_penalty": 1.2,
        "top_k": 50,
        "truncate": 1000
      }
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

You may also consume any model provider that provides compatible OpenAI API endpoint. For example, you may self-host [Portkey](https://github.com/Portkey-AI/gateway) gateway and experiment with Claude or GPTs offered by Azure OpenAI. Example for Claude from Anthropic:

```
MODELS=`[{
  "name": "claude-2.1",
  "displayName": "Claude 2.1",
  "description": "Anthropic has been founded by former OpenAI researchers...",
  "parameters": {
      "temperature": 0.5,
      "max_new_tokens": 4096,
  },
  "endpoints": [
      {
          "type": "openai",
          "baseURL": "https://gateway.example.com/v1",
          "defaultHeaders": {
              "x-portkey-config": '{"provider":"anthropic","api_key":"sk-ant-abc...xyz"}'
          }
      }
  ]
}]`
```

Example for GPT 4 deployed on Azure OpenAI:

```
MODELS=`[{
  "id": "gpt-4-1106-preview",
  "name": "gpt-4-1106-preview",
  "displayName": "gpt-4-1106-preview",
  "parameters": {
      "temperature": 0.5,
      "max_new_tokens": 4096,
  },
  "endpoints": [
      {
          "type": "openai",
          "baseURL": "https://{resource-name}.openai.azure.com/openai/deployments/{deployment-id}",
          "defaultHeaders": {
              "api-key": "{api-key}"
          },
          "defaultQuery": {
              "api-version": "2023-05-15"
          }
      }
  ]
}]`
```

Or try Mistral from [Deepinfra](https://deepinfra.com/mistralai/Mistral-7B-Instruct-v0.1/api?example=openai-http):

> Note, apiKey can either be set custom per endpoint, or globally using `OPENAI_API_KEY` variable.

```
MODELS=`[{
  "name": "mistral-7b",
  "displayName": "Mistral 7B",
  "description": "A 7B dense Transformer, fast-deployed and easily customisable. Small, yet powerful for a variety of use cases. Supports English and code, and a 8k context window.",
  "parameters": {
      "temperature": 0.5,
      "max_new_tokens": 4096,
  },
  "endpoints": [
      {
          "type": "openai",
          "baseURL": "https://api.deepinfra.com/v1/openai",
          "apiKey": "abc...xyz"
      }
  ]
}]`
```

##### Llama.cpp API server

chat-ui also supports the llama.cpp API server directly without the need for an adapter. You can do this using the `llamacpp` endpoint type.

If you want to run Chat UI with llama.cpp, you can do the following, using [microsoft/Phi-3-mini-4k-instruct-gguf](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf) as an example model:

```bash
# install llama.cpp
brew install llama.cpp
# start llama.cpp server
llama-server --hf-repo microsoft/Phi-3-mini-4k-instruct-gguf --hf-file Phi-3-mini-4k-instruct-q4.gguf -c 4096
```

```env
MODELS=`[
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
]`
```

Start chat-ui with `npm run dev` and you should be able to chat with Zephyr locally.

#### Ollama

We also support the Ollama inference server. Spin up a model with

```cli
ollama run mistral
```

Then specify the endpoints like so:

```env
MODELS=`[
  {
      "name": "Ollama Mistral",
      "chatPromptTemplate": "<s>{{#each messages}}{{#ifUser}}[INST] {{#if @first}}{{#if @root.preprompt}}{{@root.preprompt}}\n{{/if}}{{/if}} {{content}} [/INST]{{/ifUser}}{{#ifAssistant}}{{content}}</s> {{/ifAssistant}}{{/each}}",
      "parameters": {
        "temperature": 0.1,
        "top_p": 0.95,
        "repetition_penalty": 1.2,
        "top_k": 50,
        "truncate": 3072,
        "max_new_tokens": 1024,
        "stop": ["</s>"]
      },
      "endpoints": [
        {
         "type": "ollama",
         "url" : "http://127.0.0.1:11434",
         "ollamaName" : "mistral"
        }
      ]
  }
]`
```

#### Anthropic

We also support Anthropic models (including multimodal ones via `multmodal: true`) through the official SDK. You may provide your API key via the `ANTHROPIC_API_KEY` env variable, or alternatively, through the `endpoints.apiKey` as per the following example.

```
MODELS=`[
  {
      "name": "claude-3-haiku-20240307",
      "displayName": "Claude 3 Haiku",
      "description": "Fastest and most compact model for near-instant responsiveness",
      "multimodal": true,
      "parameters": {
        "max_new_tokens": 4096,
      },
      "endpoints": [
        {
          "type": "anthropic",
          // optionals
          "apiKey": "sk-ant-...",
          "baseURL": "https://api.anthropic.com",
          "defaultHeaders": {},
          "defaultQuery": {}
        }
      ]
  },
  {
      "name": "claude-3-sonnet-20240229",
      "displayName": "Claude 3 Sonnet",
      "description": "Ideal balance of intelligence and speed",
      "multimodal": true,
      "parameters": {
        "max_new_tokens": 4096,
      },
      "endpoints": [
        {
          "type": "anthropic",
          // optionals
          "apiKey": "sk-ant-...",
          "baseURL": "https://api.anthropic.com",
          "defaultHeaders": {},
          "defaultQuery": {}
        }
      ]
  },
  {
      "name": "claude-3-opus-20240229",
      "displayName": "Claude 3 Opus",
      "description": "Most powerful model for highly complex tasks",
      "multimodal": true,
      "parameters": {
         "max_new_tokens": 4096
      },
      "endpoints": [
        {
          "type": "anthropic",
          // optionals
          "apiKey": "sk-ant-...",
          "baseURL": "https://api.anthropic.com",
          "defaultHeaders": {},
          "defaultQuery": {}
        }
      ]
  }
]`
```

We also support using Anthropic models running on Vertex AI. Authentication is done using Google Application Default Credentials. Project ID can be provided through the `endpoints.projectId` as per the following example:

```
MODELS=`[
  {
      "name": "claude-3-sonnet@20240229",
      "displayName": "Claude 3 Sonnet",
      "description": "Ideal balance of intelligence and speed",
      "multimodal": true,
      "parameters": {
        "max_new_tokens": 4096,
      },
      "endpoints": [
        {
          "type": "anthropic-vertex",
          "region": "us-central1",
          "projectId": "gcp-project-id",
          // optionals
          "defaultHeaders": {},
          "defaultQuery": {}
        }
      ]
  },
  {
      "name": "claude-3-haiku@20240307",
      "displayName": "Claude 3 Haiku",
      "description": "Fastest, most compact model for near-instant responsiveness",
      "multimodal": true,
      "parameters": {
         "max_new_tokens": 4096
      },
      "endpoints": [
        {
          "type": "anthropic-vertex",
          "region": "us-central1",
          "projectId": "gcp-project-id",
          // optionals
          "defaultHeaders": {},
          "defaultQuery": {}
        }
      ]
  }
]`
```

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

#### Cloudflare Workers AI

You can also use Cloudflare Workers AI to run your own models with serverless inference.

You will need to have a Cloudflare account, then get your [account ID](https://developers.cloudflare.com/fundamentals/setup/find-account-and-zone-ids/) as well as your [API token](https://developers.cloudflare.com/workers-ai/get-started/rest-api/#1-get-an-api-token) for Workers AI.

You can either specify them directly in your `.env.local` using the `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` variables, or you can set them directly in the endpoint config.

You can find the list of models available on Cloudflare [here](https://developers.cloudflare.com/workers-ai/models/#text-generation).

```env
  {
  "name" : "nousresearch/hermes-2-pro-mistral-7b",
  "tokenizer": "nousresearch/hermes-2-pro-mistral-7b",
  "parameters": {
    "stop": ["<|im_end|>"]
  },
  "endpoints" : [
    {
      "type" : "cloudflare"
      <!-- optionally specify these
      "accountId": "your-account-id",
      "authToken": "your-api-token"
      -->
    }
  ]
}
```

#### Cohere

You can also use Cohere to run their models directly from chat-ui. You will need to have a Cohere account, then get your [API token](https://dashboard.cohere.com/api-keys). You can either specify it directly in your `.env.local` using the `COHERE_API_TOKEN` variable, or you can set it in the endpoint config.

Here is an example of a Cohere model config. You can set which model you want to use by setting the `id` field to the model name.

```env
  {
    "name" : "CohereForAI/c4ai-command-r-v01",
    "id": "command-r",
    "description": "C4AI Command-R is a research release of a 35 billion parameter highly performant generative model",
    "endpoints": [
      {
        "type": "cohere",
        <!-- optionally specify these, or use COHERE_API_TOKEN
        "apiKey": "your-api-token"
        -->
      }
    ]
  }
```

##### Google Vertex models

Chat UI can connect to the google Vertex API endpoints ([List of supported models](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models)).

To enable:

1. [Select](https://console.cloud.google.com/project) or [create](https://cloud.google.com/resource-manager/docs/creating-managing-projects#creating_a_project) a Google Cloud project.
1. [Enable billing for your project](https://cloud.google.com/billing/docs/how-to/modify-project).
1. [Enable the Vertex AI API](https://console.cloud.google.com/flows/enableapi?apiid=aiplatform.googleapis.com).
1. [Set up authentication with a service account](https://cloud.google.com/docs/authentication/getting-started)
   so you can access the API from your local workstation.

The service account credentials file can be imported as an environmental variable:

```env
    GOOGLE_APPLICATION_CREDENTIALS = clientid.json
```

Make sure your docker container has access to the file and the variable is correctly set.
Afterwards Google Vertex endpoints can be configured as following:

```
MODELS=`[
//...
    {
       "name": "gemini-1.5-pro",
       "displayName": "Vertex Gemini Pro 1.5",
       "multimodal": true,
       "endpoints" : [{
          "type": "vertex",
          "project": "abc-xyz",
          "location": "europe-west3",
          "extraBody": {
          "model_version": "gemini-1.5-pro-preview-0409",
          },

          // Optional
          "safetyThreshold": "BLOCK_MEDIUM_AND_ABOVE",
          "apiEndpoint": "", // alternative api endpoint url,
          "tools": [{
            "googleSearchRetrieval": {
              "disableAttribution": true
            }
          }],
          "multimodal": {
            "image": {
              "supportedMimeTypes": ["image/png", "image/jpeg", "image/webp"],
              "preferredMimeType": "image/png",
              "maxSizeInMB": 5,
              "maxWidth": 2000,
              "maxHeight": 1000,
            }
          }
       }]
     },
]`

```

##### LangServe

LangChain applications that are deployed using LangServe can be called with the following config:

```
MODELS=`[
//...
    {
       "name": "summarization-chain", //model-name
       "endpoints" : [{
         "type": "langserve",
         "url" : "http://127.0.0.1:8100",
       }]
     },
]`

```

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

Please note that if `HF_TOKEN` is also set or not empty, it will take precedence.

#### Models hosted on multiple custom endpoints

If the model being hosted will be available on multiple servers/instances add the `weight` parameter to your `.env.local`. The `weight` will be used to determine the probability of requesting a particular endpoint.

```env
"endpoints": [
  {
    "url": "https://HOST:PORT",
    "weight": 1
  },
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

#### Specific Embedding Model

A model can use any of the embedding models defined in `.env.local`, (currently used when web searching),
by default it will use the first embedding model, but it can be changed with the field `embeddingModel`:

```env
TEXT_EMBEDDING_MODELS = `[
  {
    "name": "Xenova/gte-small",
    "chunkCharLength": 512,
    "endpoints": [
      {"type": "transformersjs"}
    ]
  },
  {
    "name": "intfloat/e5-base-v2",
    "chunkCharLength": 768,
    "endpoints": [
      {"type": "tei", "url": "http://127.0.0.1:8080/", "authorization": "Basic VVNFUjpQQVNT"},
      {"type": "tei", "url": "http://127.0.0.1:8081/"}
    ]
  }
]`

MODELS=`[
  {
      "name": "Ollama Mistral",
      "chatPromptTemplate": "...",
      "embeddingModel": "intfloat/e5-base-v2"
      "parameters": {
        ...
      },
      "endpoints": [
        ...
      ]
  }
]`
```

## Common issues

### 403：You don't have access to this conversation

Most likely you are running chat-ui over HTTP. The recommended option is to setup something like NGINX to handle HTTPS and proxy the requests to chat-ui. If you really need to run over HTTP you can add `ALLOW_INSECURE_COOKIES=true` to your `.env.local`.

Make sure to set your `PUBLIC_ORIGIN` in your `.env.local` to the correct URL as well.

## Deploying to a HF Space

Create a `DOTENV_LOCAL` secret to your HF space with the content of your .env.local, and they will be picked up automatically when you run.

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://kit.svelte.dev/docs/adapters) for your target environment.

## Config changes for HuggingChat

The config file for HuggingChat is stored in the `chart/env/prod.yaml` file. It is the source of truth for the environment variables used for our CI/CD pipeline. For HuggingChat, as we need to customize the app color, as well as the base path, we build a custom docker image. You can find the workflow here.

> [!TIP]
> If you want to make changes to the model config used in production for HuggingChat, you should do so against `chart/env/prod.yaml`.

### Running a copy of HuggingChat locally

If you want to run an exact copy of HuggingChat locally, you will need to do the following first:

1. Create an [OAuth App on the hub](https://huggingface.co/settings/applications/new) with `openid profile email` permissions. Make sure to set the callback URL to something like `http://localhost:5173/chat/login/callback` which matches the right path for your local instance.
2. Create a [HF Token](https://huggingface.co/settings/tokens) with your Hugging Face account. You will need a Pro account to be able to access some of the larger models available through HuggingChat.
3. Create a free account with [serper.dev](https://serper.dev/) (you will get 2500 free search queries)
4. Run an instance of mongoDB, however you want. (Local or remote)

You can then create a new `.env.SECRET_CONFIG` file with the following content

```env
MONGODB_URL=<link to your mongo DB from step 4>
HF_TOKEN=<your HF token from step 2>
OPENID_CONFIG=`{
  PROVIDER_URL: "https://huggingface.co",
  CLIENT_ID: "<your client ID from step 1>",
  CLIENT_SECRET: "<your client secret from step 1>",
}`
SERPER_API_KEY=<your serper API key from step 3>
MESSAGES_BEFORE_LOGIN=<can be any numerical value, or set to 0 to require login>
```

You can then run `npm run updateLocalEnv` in the root of chat-ui. This will create a `.env.local` file which combines the `chart/env/prod.yaml` and the `.env.SECRET_CONFIG` file. You can then run `npm run dev` to start your local instance of HuggingChat.

### Populate database

> [!WARNING]
> The `MONGODB_URL` used for this script will be fetched from `.env.local`. Make sure it's correct! The command runs directly on the database.

You can populate the database using faker data using the `populate` script:

```bash
npm run populate <flags here>
```

At least one flag must be specified, the following flags are available:

- `reset` - resets the database
- `all` - populates all tables
- `users` - populates the users table
- `settings` - populates the settings table for existing users
- `assistants` - populates the assistants table for existing users
- `conversations` - populates the conversations table for existing users

For example, you could use it like so:

```bash
npm run populate reset
```

to clear out the database. Then login in the app to create your user and run the following command:

```bash
npm run populate users settings assistants conversations
```

to populate the database with fake data, including fake conversations and assistants for your user.
