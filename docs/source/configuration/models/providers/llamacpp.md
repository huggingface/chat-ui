# Llama.cpp

| Feature                     | Available |
| --------------------------- | --------- |
| [Tools](../tools)           | No        |
| [Multimodal](../multimodal) | No        |

Chat UI supports the llama.cpp API server directly without the need for an adapter. You can do this using the `llamacpp` endpoint type.

If you want to run Chat UI with llama.cpp, you can do the following, using Zephyr as an example model:

1. Get [the weights](https://huggingface.co/TheBloke/zephyr-7B-beta-GGUF/tree/main) from the hub
2. Run the server with the following command: `./server -m models/zephyr-7b-beta.Q4_K_M.gguf -c 2048 -np 3`
3. Add the following to your `.env.local`:

```ini
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
