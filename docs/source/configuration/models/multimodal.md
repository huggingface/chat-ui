# Multimodal

We currently support [IDEFICS](https://huggingface.co/blog/idefics) (hosted on [TGI](./providers/tgi)), OpenAI and Anthropic Claude 3 as multimodal models. You can enable it by setting `multimodal: true` in your `MODELS` configuration. For IDEFICS, you must have a [PRO HF Api token](https://huggingface.co/settings/tokens). For OpenAI, see the [OpenAI section](./providers/openai). For Anthropic, see the [Anthropic section](./providers/anthropic).

```ini
MODELS=`[
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
]`
```
