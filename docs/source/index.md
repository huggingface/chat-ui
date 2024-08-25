# 🤗 Chat UI

Open source chat interface with support for tools, web search, multimodal and many API providers. The app uses MongoDB and SvelteKit behind the scenes. Try the live version of the app called [HuggingChat on hf.co/chat](https://huggingface.co/chat) or [setup your own instance](./installation/spaces).

🔧 **[Tools](./configuration/models/tools)**: Function calling with custom tools and support for [Zero GPU spaces](https://huggingface.co/spaces/enzostvs/zero-gpu-spaces)

🔍 **[Web Search](./configuration/web-search)**: Automated web search, scraping and RAG for all models

🐙 **[Multimodal](./configuration/models/multimodal)**: Accepts image file uploads on supported providers

👤 **[OpenID](./configuration/open-id)**: Optionally setup OpenID for user authentication

<div class="flex gap-x-4">

<div>
Tools
<div class="flex justify-center">
<img class="block dark:hidden" src="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chat-ui/tools-light.png" height="auto"/>
<img class="hidden dark:block" src="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chat-ui/tools-dark.png" height="auto"/>
</div>
</div>

<div>
Web Search
<div class="flex justify-center">
<img class="block dark:hidden" src="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chat-ui/websearch-light.png" height="auto"/>
<img class="hidden dark:block" src="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chat-ui/websearch-dark.png" height="auto"/>
</div>
</div>

</div>

## Quickstart

You can quickly have a locally running chat-ui & LLM text-generation server thanks to chat-ui's [llama.cpp server support](https://huggingface.co/docs/chat-ui/configuration/models/providers/llamacpp).

**Step 1 (Start llama.cpp server):**

```bash
# install llama.cpp
brew install llama.cpp
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

Read more [here](https://huggingface.co/docs/chat-ui/configuration/models/providers/llamacpp).

**Step 3 (make sure you have MongoDb running locally):**

```bash
docker run -d -p 27017:27017 --name mongo-chatui mongo:latest
```

Read more [here](https://github.com/huggingface/chat-ui?tab=Readme-ov-file#database).

**Step 4 (start chat-ui):**

```bash
git clone https://github.com/huggingface/chat-ui
cd chat-ui
npm install
npm run dev -- --open
```

Read more [here](https://github.com/huggingface/chat-ui?tab=readme-ov-file#launch).

<div class="flex justify-center">
<img class="block dark:hidden" src="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chat-ui/llamacpp-light.png" height="auto"/>
<img class="hidden dark:block" src="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chat-ui/llamacpp-dark.png" height="auto"/>
</div>
