# Anthropic

| Feature                     | Available |
| --------------------------- | --------- |
| [Tools](../tools)           | No        |
| [Multimodal](../multimodal) | Yes       |

We also support Anthropic models (including multimodal ones via `multmodal: true`) through the official SDK. You may provide your API key via the `ANTHROPIC_API_KEY` env variable, or alternatively, through the `endpoints.apiKey` as per the following example.

```ini
MODELS=`[
  {
      "name": "claude-3-haiku-20240307",
      "displayName": "Claude 3 Haiku",
      "description": "Fastest and most compact model for near-instant responsiveness",
      "multimodal": true,
      "parameters": {
        "max_new_tokens": 4096,
      },
      "endpoints": [
        {
          "type": "anthropic",
          // optionals
          "apiKey": "sk-ant-...",
          "baseURL": "https://api.anthropic.com",
          "defaultHeaders": {},
          "defaultQuery": {}
        }
      ]
  },
  {
      "name": "claude-3-sonnet-20240229",
      "displayName": "Claude 3 Sonnet",
      "description": "Ideal balance of intelligence and speed",
      "multimodal": true,
      "parameters": {
        "max_new_tokens": 4096,
      },
      "endpoints": [
        {
          "type": "anthropic",
          // optionals
          "apiKey": "sk-ant-...",
          "baseURL": "https://api.anthropic.com",
          "defaultHeaders": {},
          "defaultQuery": {}
        }
      ]
  },
  {
      "name": "claude-3-opus-20240229",
      "displayName": "Claude 3 Opus",
      "description": "Most powerful model for highly complex tasks",
      "multimodal": true,
      "parameters": {
         "max_new_tokens": 4096
      },
      "endpoints": [
        {
          "type": "anthropic",
          // optionals
          "apiKey": "sk-ant-...",
          "baseURL": "https://api.anthropic.com",
          "defaultHeaders": {},
          "defaultQuery": {}
        }
      ]
  }
]`
```

## VertexAI

We also support using Anthropic models running on Vertex AI. Authentication is done using Google Application Default Credentials. Project ID can be provided through the `endpoints.projectId` as per the following example:

```ini
MODELS=`[
  {
      "name": "claude-3-haiku@20240307",
      "displayName": "Claude 3 Haiku",
      "description": "Fastest, most compact model for near-instant responsiveness",
      "multimodal": true,
      "parameters": {
         "max_new_tokens": 4096
      },
      "endpoints": [
        {
          "type": "anthropic-vertex",
          "region": "us-central1",
          "projectId": "gcp-project-id",
          // optionals
          "defaultHeaders": {},
          "defaultQuery": {}
        }
      ]
  },
  {
      "name": "claude-3-sonnet@20240229",
      "displayName": "Claude 3 Sonnet",
      "description": "Ideal balance of intelligence and speed",
      "multimodal": true,
      "parameters": {
        "max_new_tokens": 4096,
      },
      "endpoints": [
        {
          "type": "anthropic-vertex",
          "region": "us-central1",
          "projectId": "gcp-project-id",
          // optionals
          "defaultHeaders": {},
          "defaultQuery": {}
        }
      ]
  },
]`
```
