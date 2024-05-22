# Amazon Web Services (AWS)

| Feature                     | Available |
| --------------------------- | --------- |
| [Tools](../tools)           | No        |
| [Multimodal](../multimodal) | No        |

You may specify your Amazon SageMaker instance as an endpoint for Chat UI:

```ini
MODELS=`[{
  "name": "your-model",
  "displayName": "Your Model",
  "description": "Your description",
  "parameters": {
     "max_new_tokens": 4096
  },
  "endpoints": [
    {
      "type" : "aws",
      "service" : "sagemaker"
      "url": "",
      "accessKey": "",
      "secretKey" : "",
      "sessionToken": "",
      "region": "",
      "weight": 1
    }
  ]
}]`
```

You can also set `"service": "lambda"` to use a lambda instance.

You can get the `accessKey` and `secretKey` from your AWS user, under programmatic access.
