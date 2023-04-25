In this v0 of huggingchat, we only store messages to display them to the user, not for any other usage (including for research or model training purposes).

Please note that in v0, users are not authenticated in any way, i.e. this app doesn't have access to your HF user account even if you're logged in to hf.co. The app is only using a anonymous session cookie. warning this means if you change browser, or clear cookies, you will lose your conversations

In a future version, we are thinking of exposing a setting for users to share their convos with the model authors (here OpenAssistant) for them to improve their training data and their model over time. In other terms, model authors are the custodian of the data collected by their model even if it's hosted on our platform.

Finally, this app is running in a Space, which entails that the code for this UI is open source: https://huggingface.co/spaces/huggingchat/chat-ui/tree/main
The inference backend is running [text-generation-inference](https://github.com/huggingface/text-generation-inference) on huggingface Inference API infrastructure.

It is therefore possible to deploy a copy of this app to a Space and customize it (swap model, add some UI elements, or store user messages according to your own Terms and conditions)

We welcome any feedback on this app: please participate to the public discussion at https://huggingface.co/spaces/huggingchat/chat-ui/discussions (button to open discussion)

Coming soon

- LLM watermarking
- user setting to share conversations with model authors.
