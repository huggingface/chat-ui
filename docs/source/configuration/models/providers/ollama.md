# Ollama

| Feature                     | Available |
| --------------------------- | --------- |
| [Tools](../tools)           | No        |
| [Multimodal](../multimodal) | No        |

We also support the Ollama inference server. Spin up a model with

```bash
ollama run mistral
```

Then specify the endpoints like so:

```ini
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
