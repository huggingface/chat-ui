# Text Generation Inference (TGI)

| Feature                     | Available |
| --------------------------- | --------- |
| [Tools](../tools)           | Yes\*     |
| [Multimodal](../multimodal) | Yes\*     |

\* Tools are only supported with the Cohere Command R+ model with the Xenova tokenizers. Please see the [Tools](../tools) section.

\* Multimodal is only supported with the IDEFICS model. Please see the [Multimodal](../multimodal) section.

By default, if `endpoints` are left unspecified, Chat UI will look for the model on the hosted Hugging Face inference API using the model name, and use your `HF_TOKEN`. Refer to the [overview](../overview) for more information about model configuration.

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

## Running your own models using a custom endpoint

If you want to, instead of hitting models on the Hugging Face Inference API, you can run your own models locally.

A good option is to hit a [text-generation-inference](https://github.com/huggingface/text-generation-inference) endpoint. This is what is done in the official [Chat UI Spaces Docker template](https://huggingface.co/new-space?template=huggingchat/chat-ui-template) for instance: both this app and a text-generation-inference server run inside the same container.

To do this, you can add your own endpoints to the `MODELS` variable in `.env.local`, by adding an `"endpoints"` key for each model in `MODELS`.

```ini
MODELS=`[{
  "name": "your-model-name",
  "displayName": "Your Model Name",
  ... other model config
  "endpoints": [{
    "type" : "tgi",
    "url": "https://HOST:PORT",
  }]
}]`
```
