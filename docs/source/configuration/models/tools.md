# Tools

Tool calling instructs the model to generate an output matching a user-defined schema, which may be parsed for invoking external tools. The model simply chooses the tools and their parameters. Currently, only `TGI` and `Cohere` with `Command R+` are supported. If you're interested in extending tools support, please see the `src/lib/server/endpoints/cohere` provider for native tool calling.

## Adding tools

Tool implementations are placed in `src/lib/server/tools`, with helpers available for easy integration with HuggingFace Zero GPU spaces. In the future, there may be an OpenAPI interface for adding tools.

## TGI Configuration

A custom tokenizer is required for prompting the model for generating tool calls, as well as prompting with the results. The expected format for these tools and the resulting tool calls are hard coded for TGI, so it's likely that only the following configuration will work:

```ini
MODELS=`[
  {
    "name" : "CohereForAI/c4ai-command-r-plus",
    "displayName": "Command R+",
    "description": "Command R+ is Cohere's latest LLM and is the first open weight model to beat GPT4 in the Chatbot Arena!",
    "tools": true,
    "tokenizer": "Xenova/c4ai-command-r-v01-tokenizer",
    "modelUrl": "https://huggingface.co/CohereForAI/c4ai-command-r-plus",
    "websiteUrl": "https://docs.cohere.com/docs/command-r-plus",
    "logoUrl": "https://huggingface.co/datasets/huggingchat/models-logo/resolve/main/cohere-logo.png",
    "parameters": {
      "stop": ["<|END_OF_TURN_TOKEN|>"],
      "truncate" : 28672,
      "max_new_tokens" : 4096,
      "temperature" : 0.3
    }
  }
]`
```

## Cohere Configuration

The Cohere provider supports the endpoint native method of tool calling. Refer to the `endpoints/cohere` for implementation details.

```ini
MODELS=`[
  {
    "name": "command-r-plus",
    "displayName": "Command R+",
    "description": "Command R+ is Cohere's latest LLM and is the first open weight model to beat GPT4 in the Chatbot Arena!",
    "tools": true,
    "websiteUrl": "https://docs.cohere.com/docs/command-r-plus",
    "logoUrl": "https://huggingface.co/datasets/huggingchat/models-logo/resolve/main/cohere-logo.png",
    "endpoints": [{
      "type": "cohere",
      "apiKey": "YOUR_API_KEY"
    }]
  }
]`
```
