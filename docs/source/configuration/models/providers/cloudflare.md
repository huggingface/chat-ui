# Cloudflare

| Feature                        | Available |
| ------------------------------ | --------- |
| [Tools](../tools.md)           | No        |
| [Multimodal](../multimodal.md) | No        |

You may use Cloudflare Workers AI to run your own models with serverless inference.

You will need to have a Cloudflare account, then get your [account ID](https://developers.cloudflare.com/fundamentals/setup/find-account-and-zone-ids/) as well as your [API token](https://developers.cloudflare.com/workers-ai/get-started/rest-api/#1-get-an-api-token) for Workers AI.

You can either specify them directly in your `.env.local` using the `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` variables, or you can set them directly in the endpoint config.

You can find the list of models available on Cloudflare [here](https://developers.cloudflare.com/workers-ai/models/#text-generation).

```ini
MODELS=`[
  {
    "name" : "nousresearch/hermes-2-pro-mistral-7b",
    "tokenizer": "nousresearch/hermes-2-pro-mistral-7b",
    "parameters": {
      "stop": ["<|im_end|>"]
    },
    "endpoints" : [
      {
        "type" : "cloudflare"
        <!-- optionally specify these
        "accountId": "your-account-id",
        "authToken": "your-api-token"
        -->
      }
    ]
  }
]`
```
