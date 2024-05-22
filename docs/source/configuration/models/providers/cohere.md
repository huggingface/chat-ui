# Cohere

| Feature                     | Available |
| --------------------------- | --------- |
| [Tools](../tools)           | Yes       |
| [Multimodal](../multimodal) | No        |

You may use Cohere to run their models directly from Chat UI. You will need to have a Cohere account, then get your [API token](https://dashboard.cohere.com/api-keys). You can either specify it directly in your `.env.local` using the `COHERE_API_TOKEN` variable, or you can set it in the endpoint config.

Here is an example of a Cohere model config. You can set which model you want to use by setting the `id` field to the model name.

```ini
MODELS=`[
  {
    "name": "command-r-plus",
    "displayName": "Command R+",
    "tools": true,
    "endpoints": [{
      "type": "cohere",
      <!-- optionally specify these, or use COHERE_API_TOKEN
      "apiKey": "your-api-token"
      -->
    }]
  }
]`
```
