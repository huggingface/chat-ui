## Privacy

In this `v0` of HuggingChat, we only store messages to display them to the user, not for any other usage (including for research or model training purposes).

Please note that in `v0`, users are not authenticated in any way, i.e. this app doesn't have access to your HF user account even if you're logged in to huggingface.co. The app is only using an anonymous session cookie. ❗️ Warning ❗️ this means if you switch browsers or clear cookies, you will currently lose your conversations.

In a future version, we are considering exposing a setting for users to share their conversations with the model authors (here OpenAssistant) to improve their training data and their model over time. In other terms, model authors are the custodians of the data collected by their model, even if it's hosted on our platform.

## About available LLMs

The goal of this app is to showcase that it is now (April 2023) possible to build an open source alternative to ChatGPT. 💪

For now, it's running OpenAssistant's [latest LLaMA based model](https://huggingface.co/OpenAssistant/oasst-sft-6-llama-30b-xor) (which is one of the current best open source chat models), but the plan in the longer-term is to expose all good-quality chat models from the Hub.

## Technical details

This app is running in a [Space](https://huggingface.co/docs/hub/spaces-overview), which entails that the code for this UI is open source: https://huggingface.co/spaces/huggingchat/chat-ui/tree/main.
The inference backend is running [text-generation-inference](https://github.com/huggingface/text-generation-inference) on HuggingFace's Inference API infrastructure.

It is therefore possible to deploy a copy of this app to a Space and customize it (swap model, add some UI elements, or store user messages according to your own Terms and conditions)

We welcome any feedback on this app: please participate to the public discussion at https://huggingface.co/spaces/huggingchat/chat-ui/discussions

[![open a discussion](https://huggingface.co/datasets/huggingface/badges/raw/main/open-a-discussion-xl.svg)](https://huggingface.co/spaces/huggingchat/chat-ui/discussions)

## Coming soon

- LLM watermarking
- User setting to share conversations with model authors
