## Privacy

> Last updated: July 23, 2023

Users of HuggingChat are authenticated through their HF user account.

By default, your conversations may be shared with the respective models' authors (e.g. if you're chatting with the Open Assistant model, to <a target="_blank" href="https://open-assistant.io/dashboard">Open Assistant</a>) to improve their training data and model over time. Model authors are the custodians of the data collected by their model, even if it's hosted on our platform.

If you disable data sharing in your settings, your conversations will not be used for any downstream usage (including for research or model training purposes), and they will only be stored to let you access past conversations. You can click on the Delete icon to delete any past conversation at any moment.

🗓 Please also consult huggingface.co's main privacy policy at https://huggingface.co/privacy. To exercise any of your legal privacy rights, please send an email to privacy@huggingface.co.

## About available LLMs

The goal of this app is to showcase that it is now (May 2023) possible to build an open source alternative to ChatGPT. 💪

For now, it's running both OpenAssistant's [latest LLaMA based model](https://huggingface.co/OpenAssistant/oasst-sft-6-llama-30b-xor) (which is one of the current best open source chat models) as well as [Meta's newer Llama 2](https://huggingface.co/meta-llama/Llama-2-70b-chat-hf), but the plan in the longer-term is to expose all good-quality chat models from the Hub.

We are not affiliated with Open Assistant nor Meta AI, but if you want to contribute to the training data for the next generation of open models, please consider contributing to https://open-assistant.io/ or https://ai.meta.com/llama/ ❤️

## Technical details

This app is running in a [Space](https://huggingface.co/docs/hub/spaces-overview), which entails that the code for this UI is publicly visible [inside the Space repo](https://huggingface.co/spaces/huggingchat/chat-ui/tree/main).

**Further development takes place on the [huggingface/chat-ui GitHub repo](https://github.com/huggingface/chat-ui).**

The inference backend is running the optimized [text-generation-inference](https://github.com/huggingface/text-generation-inference) on HuggingFace's Inference API infrastructure.

It is therefore possible to deploy a copy of this app to a Space and customize it (swap model, add some UI elements, or store user messages according to your own Terms and conditions). You can also 1-click deploy your own instance using the [Chat UI Spaces Docker template](https://huggingface.co/new-space?template=huggingchat/chat-ui-template).

We welcome any feedback on this app: please participate to the public discussion at https://huggingface.co/spaces/huggingchat/chat-ui/discussions

<a target="_blank" href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions"><img src="https://huggingface.co/datasets/huggingface/badges/raw/main/open-a-discussion-xl.svg" title="open a discussion"></a>

## Coming soon

- User setting to share conversations with model authors (done ✅)
- LLM watermarking
