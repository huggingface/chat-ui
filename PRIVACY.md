## Privacy

> Last updated: October 4, 2023

Users of HuggingChat are authenticated through their HF user account.

By default, your conversations may be shared with the respective models' authors to improve their training data and model over time. Model authors are the custodians of the data collected by their model, even if it's hosted on our platform.

If you disable data sharing in your settings, your conversations will not be used for any downstream usage (including for research or model training purposes), and they will only be stored to let you access past conversations. You can click on the Delete icon to delete any past conversation at any moment.

🗓 Please also consult huggingface.co's main privacy policy at <https://huggingface.co/privacy>. To exercise any of your legal privacy rights, please send an email to <privacy@huggingface.co>.

## About available LLMs

The goal of this app is to showcase that it is now possible to build an open source alternative to ChatGPT. 💪

For now (October 2023), it's running:

- [Llama 2 70B](https://huggingface.co/meta-llama/Llama-2-70b-chat-hf)
- [CodeLlama 35B](https://about.fb.com/news/2023/08/code-llama-ai-for-coding/)
- [Falcon 180B](https://www.tii.ae/news/technology-innovation-institute-introduces-worlds-most-powerful-open-llm-falcon-180b)
- [Mistral 7B](https://mistral.ai/news/announcing-mistral-7b/)

## Technical details

This app is running in a [Space](https://huggingface.co/docs/hub/spaces-overview), which entails that the code for this UI is publicly visible [inside the Space repo](https://huggingface.co/spaces/huggingchat/chat-ui/tree/main).

**Further development takes place on the [huggingface/chat-ui GitHub repo](https://github.com/huggingface/chat-ui).**

The inference backend is running the optimized [text-generation-inference](https://github.com/huggingface/text-generation-inference) on HuggingFace's Inference API infrastructure.

It is therefore possible to deploy a copy of this app to a Space and customize it (swap model, add some UI elements, or store user messages according to your own Terms and conditions). You can also 1-click deploy your own instance using the [Chat UI Spaces Docker template](https://huggingface.co/new-space?template=huggingchat/chat-ui-template).

We welcome any feedback on this app: please participate to the public discussion at <https://huggingface.co/spaces/huggingchat/chat-ui/discussions>

<a target="_blank" href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions"><img src="https://huggingface.co/datasets/huggingface/badges/raw/main/open-a-discussion-xl.svg" title="open a discussion"></a>
