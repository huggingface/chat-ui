# OpenAI

| Feature                     | Available |
| --------------------------- | --------- |
| [Tools](../tools)           | No        |
| [Multimodal](../multimodal) | Yes       |

Chat UI can be used with any API server that supports OpenAI API compatibility, for example [text-generation-webui](https://github.com/oobabooga/text-generation-webui/tree/main/extensions/openai), [LocalAI](https://github.com/go-skynet/LocalAI), [FastChat](https://github.com/lm-sys/FastChat/blob/main/docs/openai_api.md), [llama-cpp-python](https://github.com/abetlen/llama-cpp-python), and [ialacol](https://github.com/chenhunghan/ialacol) and [vllm](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html).

The following example config makes Chat UI works with [text-generation-webui](https://github.com/oobabooga/text-generation-webui/tree/main/extensions/openai), the `endpoint.baseUrl` is the url of the OpenAI API compatible server, this overrides the baseUrl to be used by OpenAI instance. The `endpoint.completion` determine which endpoint to be used, default is `chat_completions` which uses `/chat/completions`, change to `endpoint.completion` to `completions` to use the `/completions` endpoint.

```ini
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

```ini
OPENAI_API_KEY=#your openai api key here
MODELS=`[{
  "name": "gpt-4",
  "displayName": "GPT 4",
  "endpoints" : [{
    "type": "openai",
    "apiKey": "or your openai api key here"
  }]
},{
  "name": "gpt-3.5-turbo",
  "displayName": "GPT 3.5 Turbo",
  "endpoints" : [{
    "type": "openai",
    "apiKey": "or your openai api key here"
  }]
}]`
```

We also support models in the `o1` family. You need to add a few more options ot the config: Here is an example for `o1-mini`:

```ini
MODELS=`[
  {
      "name": "o1-mini",
      "description": "ChatGPT o1-mini",
      "systemRoleSupported": false,
      "parameters": {
        "max_new_tokens": 2048,
      },
      "endpoints" : [{
        "type": "openai",
        "useCompletionTokens": true,
      }]
  }
]
```

You may also consume any model provider that provides compatible OpenAI API endpoint. For example, you may self-host [Portkey](https://github.com/Portkey-AI/gateway) gateway and experiment with Claude or GPTs offered by Azure OpenAI. Example for Claude from Anthropic:

```ini
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

```ini
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

## DeepInfra

Or try Mistral from [Deepinfra](https://deepinfra.com/mistralai/Mistral-7B-Instruct-v0.1/api?example=openai-http):

> Note, apiKey can either be set custom per endpoint, or globally using `OPENAI_API_KEY` variable.

```ini
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

_Non-streaming endpoints_

For endpoints that don´t support streaming like o1 on Azure, you can pass `streamingSupported: false` in your endpoint config:

```
MODELS=`[{
  "id": "o1-preview",
  "name": "o1-preview",
  "displayName": "o1-preview",
  "systemRoleSupported": false,
  "endpoints": [
    {
      "type": "openai",
      "baseURL": "https://my-deployment.openai.azure.com/openai/deployments/o1-preview",
      "defaultHeaders": {
        "api-key": "$SECRET"
      },
      "streamingSupported": false,
    }
  ]
}]`
```

## Other

Some other providers and their `baseURL` for reference.

[Groq](https://groq.com/): https://api.groq.com/openai/v1
[Fireworks](https://fireworks.ai/): https://api.fireworks.ai/inference/v1

```

```
