# Llama.cpp

| Feature                     | Available |
| --------------------------- | --------- |
| [Tools](../tools)           | No        |
| [Multimodal](../multimodal) | No        |

Chat UI supports the llama.cpp API server directly without the need for an adapter. You can do this using the `llamacpp` endpoint type.

If you want to run Chat UI with llama.cpp, you can do the following, using [microsoft/Phi-3-mini-4k-instruct-gguf](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf) as an example model:

```bash
# install llama.cpp
brew install llama.cpp
# start llama.cpp server
llama-server --hf-repo microsoft/Phi-3-mini-4k-instruct-gguf --hf-file Phi-3-mini-4k-instruct-q4.gguf -c 4096
```

_note: you can swap the `hf-repo` and `hf-file` with your fav GGUF on the [Hub](https://huggingface.co/models?library=gguf). For example: `--hf-repo TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF` for [this repo](https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF) & `--hf-file tinyllama-1.1b-chat-v1.0.Q4_0.gguf` for [this file](https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/blob/main/tinyllama-1.1b-chat-v1.0.Q4_0.gguf)._

A local LLaMA.cpp HTTP Server will start on `http://localhost:8080` (to change the port or any other default options, please find [LLaMA.cpp HTTP Server readme](https://github.com/ggerganov/llama.cpp/tree/master/examples/server)).

Add the following to your `.env.local`:

```ini
MODELS=`[
  {
    "name": "Local microsoft/Phi-3-mini-4k-instruct-gguf",
    "tokenizer": "microsoft/Phi-3-mini-4k-instruct-gguf",
    "preprompt": "",
    "chatPromptTemplate": "<s>{{preprompt}}{{#each messages}}{{#ifUser}}<|user|>\n{{content}}<|end|>\n<|assistant|>\n{{/ifUser}}{{#ifAssistant}}{{content}}<|end|>\n{{/ifAssistant}}{{/each}}",
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

<div class="flex justify-center">
<img class="block dark:hidden" src="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chat-ui/llamacpp-light.png" height="auto"/>
<img class="hidden dark:block" src="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chat-ui/llamacpp-dark.png" height="auto"/>
</div>
