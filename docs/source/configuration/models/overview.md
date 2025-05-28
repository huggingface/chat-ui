# Models Overview

You can customize the parameters passed to the model or even use a new model by updating the `MODELS` variable in your `.env.local`. The default one can be found in `.env` and looks like this :

```ini
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
        "title": "Write an email",
        "prompt": "As a restaurant owner, write a professional email to the supplier to get these products every week: \n\n- Wine (x10)\n- Eggs (x24)\n- Bread (x12)"
      }, {
        "title": "Code a game",
        "prompt": "Code a basic snake game in python, give explanations for each step."
      }, {
        "title": "Recipe help",
        "prompt": "How do I make a delicious lemon cheesecake?"
      }
    ]
  }
]`

```

You can change things like the parameters, or customize the preprompt to better suit your needs. You can also add more models by adding more objects to the array, with different preprompts for example.

## Chat Prompt Template

When querying the model for a chat response, the `chatPromptTemplate` template is used. `messages` is an array of chat messages, it has the format `[{ content: string }, ...]`. To identify if a message is a user message or an assistant message the `ifUser` and `ifAssistant` block helpers can be used.

The following is the default `chatPromptTemplate`, although newlines and indentation have been added for readability. You can find the prompts used in production for HuggingChat [here](https://github.com/huggingface/chat-ui/blob/main/PROMPTS.md). The templating language used is [Handlebars](https://www.npmjs.com/package/handlebars).

```handlebars
{{preprompt}}
{{#each messages}}
	{{#ifUser}}{{@root.userMessageToken}}{{content}}{{@root.userMessageEndToken}}{{/ifUser}}
	{{#ifAssistant
	}}{{@root.assistantMessageToken}}{{content}}{{@root.assistantMessageEndToken}}{{/ifAssistant}}
{{/each}}
{{assistantMessageToken}}
```

## Custom endpoint authorization

### Basic and Bearer

Custom endpoints may require authorization, depending on how you configure them. Authentication will usually be set either with `Basic` or `Bearer`.

For `Basic` we will need to generate a base64 encoding of the username and password.

`echo -n "USER:PASS" | base64`

> VVNFUjpQQVNT

For `Bearer` you can use a token, which can be grabbed from [here](https://huggingface.co/settings/tokens).

You can then add the generated information and the `authorization` parameter to your `.env.local`.

```ini
"endpoints": [
  {
    "url": "https://HOST:PORT",
    "authorization": "Basic VVNFUjpQQVNT",
  }
]
```

Please note that if `HF_TOKEN` is also set or not empty, it will take precedence.

## Models hosted on multiple custom endpoints

If the model being hosted will be available on multiple servers/instances add the `weight` parameter to your `.env.local`. The `weight` will be used to determine the probability of requesting a particular endpoint.

```ini
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

## Client Certificate Authentication (mTLS)

Custom endpoints may require client certificate authentication, depending on how you configure them. To enable mTLS between Chat UI and your custom endpoint, you will need to set the `USE_CLIENT_CERTIFICATE` to `true`, and add the `CERT_PATH` and `KEY_PATH` parameters to your `.env.local`. These parameters should point to the location of the certificate and key files on your local machine. The certificate and key files should be in PEM format. The key file can be encrypted with a passphrase, in which case you will also need to add the `CLIENT_KEY_PASSWORD` parameter to your `.env.local`.

If you're using a certificate signed by a private CA, you will also need to add the `CA_PATH` parameter to your `.env.local`. This parameter should point to the location of the CA certificate file on your local machine.

If you're using a self-signed certificate, e.g. for testing or development purposes, you can set the `REJECT_UNAUTHORIZED` parameter to `false` in your `.env.local`. This will disable certificate validation, and allow Chat UI to connect to your custom endpoint.

## Specific Embedding Model

A model can use any of the embedding models defined under `TEXT_EMBEDDING_MODELS`, (currently used when web searching). By default it will use the first embedding model, but it can be changed with the field `embeddingModel`:

```ini
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
