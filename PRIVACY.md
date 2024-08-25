## Privacy

> Last updated: April 15, 2024

Users of HuggingChat are authenticated through their HF user account.

We endorse Privacy by Design. As such, your conversations are private to you and will not be shared with anyone, including model authors, for any purpose, including for research or model training purposes.

You conversation data will only be stored to let you access past conversations. You can click on the Delete icon to delete any past conversation at any moment.

🗓 Please also consult huggingface.co's main privacy policy at <https://huggingface.co/privacy>. To exercise any of your legal privacy rights, please send an email to <privacy@huggingface.co>.

## About available LLMs

The goal of this app is to showcase that it is now possible to build an open source alternative to ChatGPT. 💪

We aim to always provide a diverse set of state of the art open LLMs, hence we rotate the available models over time.

Historically, HuggingChat has been running models such as:

- [Llama 2 70B](https://huggingface.co/meta-llama/Llama-2-70b-chat-hf)
- [CodeLlama 35B](https://about.fb.com/news/2023/08/code-llama-ai-for-coding/)
- [Falcon 180B](https://www.tii.ae/news/technology-innovation-institute-introduces-worlds-most-powerful-open-llm-falcon-180b)
- [Mistral 7B](https://mistral.ai/news/announcing-mistral-7b/)
- [Cohere Command R+](https://huggingface.co/chat/models/CohereForAI/c4ai-command-r-plus)
- [Google Gemma 7B](https://huggingface.co/chat/models/google/gemma-1.1-7b-it)

This is only a partial list. Check the [models](https://huggingface.co/chat/models/) page for up-to-date list of the best available LLMs.

## Technical details

This app is running in a [Space](https://huggingface.co/docs/hub/spaces-overview), which entails that the code for this UI is publicly visible [inside the Space repo](https://huggingface.co/spaces/huggingchat/chat-ui/tree/main).

**Further development takes place on the [huggingface/chat-ui GitHub repo](https://github.com/huggingface/chat-ui).**

The inference backend is running the optimized [text-generation-inference](https://github.com/huggingface/text-generation-inference) on HuggingFace's Inference API infrastructure.

It is therefore possible to deploy a copy of this app to a Space and customize it (swap model, add some UI elements, or store user messages according to your own Terms and conditions). You can also 1-click deploy your own instance using the [Chat UI Spaces Docker template](https://huggingface.co/new-space?template=huggingchat/chat-ui-template).

We welcome any feedback on this app: please participate to the public discussion at <https://huggingface.co/spaces/huggingchat/chat-ui/discussions>

<a target="_blank" href="https://huggingface.co/spaces/huggingchat/chat-ui/discussions"><img src="https://huggingface.co/datasets/huggingface/badges/raw/main/open-a-discussion-xl.svg" title="open a discussion"></a>
