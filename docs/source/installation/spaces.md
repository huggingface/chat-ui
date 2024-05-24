# Running on Huggingface Spaces

If you don't want to configure, setup, and launch your own Chat UI yourself, you can use this option as a fast deploy alternative.

You can deploy your own customized Chat UI instance with any supported [LLM](https://huggingface.co/models?pipeline_tag=text-generation) of your choice on [Hugging Face Spaces](https://huggingface.co/spaces). To do so, use the chat-ui template [available here](https://huggingface.co/new-space?template=huggingchat/chat-ui-template).

Set `HF_TOKEN` in [Space secrets](https://huggingface.co/docs/hub/spaces-overview#managing-secrets-and-environment-variables) to deploy a model with gated access or a model in a private repository. It's also compatible with [Inference for PROs](https://huggingface.co/blog/inference-pro) curated list of powerful models with higher rate limits. Make sure to create your personal token first in your [User Access Tokens settings](https://huggingface.co/settings/tokens).

Read the full tutorial [here](https://huggingface.co/docs/hub/spaces-sdks-docker-chatui#chatui-on-spaces).
