---
title: chat-ui
emoji: 🔥
colorFrom: purple
colorTo: purple
sdk: docker
pinned: false
license: apache-2.0
base_path: /chat
app_port: 3000
failure_strategy: rollback
load_balancing_strategy: random
---

# Chat UI

![Chat UI repository thumbnail](https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chatui-websearch.png)

Open source chat interface with support for tools, web search, multimodality, and many API providers. The app uses MongoDB and SvelteKit behind the scenes. Try the live version of the app called [HuggingChat on hf.co/chat](https://huggingface.co/chat) or [setup your own instance](https://huggingface.co/docs/chat-ui/installation/spaces).

🔧 **Tools**: Function calling with custom tools and support for [Zero GPU spaces](https://huggingface.co/spaces/enzostvs/zero-gpu-spaces)

🔍 **Web Search**: Automated web search, scraping and RAG for all models

🐙 **Multimodal**: Accepts image file uploads on supported providers

👤 **OpenID**: Optionally setup OpenID for user authentication

For more information, please find the docs at [hf.co/docs/chat-ui](https://huggingface.co/docs/chat-ui/index).
