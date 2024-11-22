# Text Embedding Models

By default (for backward compatibility), when `TEXT_EMBEDDING_MODELS` environment variable is not defined, [transformers.js](https://huggingface.co/docs/transformers.js) embedding models will be used for embedding tasks, specifically, the [Xenova/gte-small](https://huggingface.co/Xenova/gte-small) model.

You can customize the embedding model by setting `TEXT_EMBEDDING_MODELS` in your `.env.local` file where the required fields are `name`, `chunkCharLength` and `endpoints`.

Supported text embedding backends are: [`transformers.js`](https://huggingface.co/docs/transformers.js), [`TEI`](https://github.com/huggingface/text-embeddings-inference) and [`OpenAI`](https://platform.openai.com/docs/guides/embeddings). `transformers.js` models run locally as part of `chat-ui`, whereas `TEI` models run in a different environment & accessed through an API endpoint. `openai` models are accessed through the [OpenAI API](https://platform.openai.com/docs/guides/embeddings).

When more than one embedding models are supplied in `.env.local` file, the first will be used by default, and the others will only be used on LLM's which configured `embeddingModel` to the name of the model.

## Transformers.js

The Transformers.js backend uses local CPU for the embedding which can be quite slow. If possible, consider using TEI or OpenAI embeddings instead if you use web search frequently, as performance will improve significantly.

```ini
TEXT_EMBEDDING_MODELS = `[
  {
    "name": "Xenova/gte-small",
    "displayName": "Xenova/gte-small",
    "description": "locally running embedding",
    "chunkCharLength": 512,
    "endpoints": [
      { "type": "transformersjs" }
    ]
  }
]`
```

## Text Embeddings Inference (TEI)

> Text Embeddings Inference (TEI) is a comprehensive toolkit designed for efficient deployment and serving of open source text embeddings models. It enables high-performance extraction for the most popular models, including FlagEmbedding, Ember, GTE, and E5.

Some recommended models at the time of writing (May 2024) are `Snowflake/snowflake-arctic-embed-m` and `BAAI/bge-large-en-v1.5`. You may run TEI locally with GPU support via Docker:

`docker run --gpus all -p 8080:80 -v tei-data:/data --name tei ghcr.io/huggingface/text-embeddings-inference:1.2 --model-id YOUR/HF_MODEL`

You can then hook this up to your Chat UI instance with the following configuration.

```ini
TEXT_EMBEDDING_MODELS=`[
  {
    "name": "YOUR/HF_MODEL",
    "displayName": "YOUR/HF_MODEL",
    "preQuery": "Check the model documentation for the preQuery. Not all models have one",
    "prePassage": "Check the model documentation for the prePassage. Not all models have one",
    "chunkCharLength": 512,
    "endpoints": [{
      "type": "tei",
      "url": "http://127.0.0.1:8080/"
    }]
  }
]`
```

Examples for `Snowflake/snowflake-arctic-embed-m` and `BAAI/bge-large-en-v1.5`:

```ini
TEXT_EMBEDDING_MODELS=`[
  {
    "name": "Snowflake/snowflake-arctic-embed-m",
    "displayName": "Snowflake/snowflake-arctic-embed-m",
    "preQuery": "Represent this sentence for searching relevant passages: ",
    "chunkCharLength": 512,
    "endpoints": [{
      "type": "tei",
      "url": "http://127.0.0.1:8080/"
    }]
  },{
    "name": "BAAI/bge-large-en-v1.5",
    "displayName": "BAAI/bge-large-en-v1.5",
    "chunkCharLength": 512,
    "endpoints": [{
      "type": "tei",
      "url": "http://127.0.0.1:8080/"
    }]
  }
]`
```

## OpenAI

It's also possible to host your own OpenAI API compatible embedding models. [`Infinity`](https://github.com/michaelfeil/infinity) is one example. You may run it locally with Docker:

`docker run -it --gpus all -v infinity-data:/app/.cache -p 7997:7997 michaelf34/infinity:latest v2 --model-id nomic-ai/nomic-embed-text-v1 --port 7997`

You can then hook this up to your Chat UI instance with the following configuration.

```ini
TEXT_EMBEDDING_MODELS=`[
  {
    "name": "nomic-ai/nomic-embed-text-v1",
    "displayName": "nomic-ai/nomic-embed-text-v1",
    "chunkCharLength": 512,
    "model": {
      "name": "nomic-ai/nomic-embed-text-v1"
    },
    "endpoints": [
      {
        "type": "openai",
        "url": "https://127.0.0.1:7997/embeddings"
      }
    ]
  }
]`
```
