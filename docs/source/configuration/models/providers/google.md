# Google

| Feature                     | Available |
| --------------------------- | --------- |
| [Tools](../tools)           | No        |
| [Multimodal](../multimodal) | No        |

Chat UI can connect to the google Vertex API endpoints ([List of supported models](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models)).

To enable:

1. [Select](https://console.cloud.google.com/project) or [create](https://cloud.google.com/resource-manager/docs/creating-managing-projects#creating_a_project) a Google Cloud project.
1. [Enable billing for your project](https://cloud.google.com/billing/docs/how-to/modify-project).
1. [Enable the Vertex AI API](https://console.cloud.google.com/flows/enableapi?apiid=aiplatform.googleapis.com).
1. [Set up authentication with a service account](https://cloud.google.com/docs/authentication/getting-started)
   so you can access the API from your local workstation.

The service account credentials file can be imported as an environmental variable:

```ini
GOOGLE_APPLICATION_CREDENTIALS = clientid.json
```

Make sure your docker container has access to the file and the variable is correctly set.
Afterwards Google Vertex endpoints can be configured as following:

```ini
MODELS=`[
  {
    "name": "gemini-1.5-pro",
    "displayName": "Vertex Gemini Pro 1.5",
    "endpoints" : [{
      "type": "vertex",
      "project": "abc-xyz",
      "location": "europe-west3",
      "model": "gemini-1.5-pro-preview-0409", // model-name

      // Optional
      "safetyThreshold": "BLOCK_MEDIUM_AND_ABOVE",
      "apiEndpoint": "", // alternative api endpoint url,
      "tools": [{
        "googleSearchRetrieval": {
          "disableAttribution": true
        }
      }]
    }]
  }
]`
```

## GenAI

Or use the Gemini API API provider [from](https://github.com/google-gemini/generative-ai-js#readme):

> Make sure that you have an API key from Google Cloud Platform. To get an API key, follow the instructions [here](https://cloud.google.com/docs/authentication/api-keys).

```ini
MODELS=`[
  {
    "name": "gemini-1.5-flash",
    "displayName": "Gemini Flash 1.5",
    "multimodal": true,
    "endpoints": [
      {
        "type": "genai",
        "apiKey": "abc...xyz"
      }
    ]

    // Optional
    "safetyThreshold": "BLOCK_MEDIUM_AND_ABOVE",
  },
  {
    "name": "gemini-1.5-pro",
    "displayName": "Gemini Pro 1.5",
    "multimodal": false,
    "endpoints": [
      {
        "type": "genai",
        "apiKey": "abc...xyz"
      }
    ]
  }
]`
```
