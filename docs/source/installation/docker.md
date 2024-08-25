# Running on Docker

Pre-built docker images are provided with and without MongoDB built in. Refer to the [configuration section](../configuration/overview) for env variables that must be provided. We recommend using the `--env-file` option to avoid leaking secrets into your shell history.

```bash
# Without built-in DB
docker run -p 3000:3000 --env-file .env.local --name chat-ui ghcr.io/huggingface/chat-ui

# With built-in DB
docker run -p 3000:3000 --env-file .env.local -v chat-ui:/data --name chat-ui ghcr.io/huggingface/chat-ui-db
```
