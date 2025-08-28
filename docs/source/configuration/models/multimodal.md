# Multimodal

Note: This build supports only OpenAI-compatible endpoints. References to TGI/IDEFICS or Anthropic do not apply.

OpenAI multimodal models are supported when exposed via an OpenAI-compatible API. Enable multimodal by setting `multimodal: true` in your model configuration.

```ini
MODELS=`[
  {
    "name": "gpt-4o-mini",  
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
]`
```
