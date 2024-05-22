# LangServe

| Feature                                        | Available |
|------------------------------------------------|-----------|
| [Tools](/configuration/models/tools)           | No        |
| [Multimodal](/configuration/models/multimodal) | No        |

LangChain applications that are deployed using LangServe can be called with the following config:

```ini
MODELS=`[
  {
    "name": "summarization-chain",
    "displayName": "Summarization Chain"
    "endpoints" : [{
      "type": "langserve",
      "url" : "http://127.0.0.1:8100",
    }]
  }
]`

```
