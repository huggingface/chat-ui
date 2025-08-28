# Chat UI

**Find the docs at [hf.co/docs/chat-ui](https://huggingface.co/docs/chat-ui/index).**

![Chat UI repository thumbnail](https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/chatui-websearch.png)

A chat interface using open source models, eg OpenAssistant or Llama. It is a SvelteKit app and it powers the [HuggingChat app on hf.co/chat](https://huggingface.co/chat).

0. [Quickstart](#quickstart)
1. [No Setup Deploy](#no-setup-deploy)
2. [Setup](#setup)
3. [Launch](#launch)
4. [Extra parameters](#extra-parameters)
5. [Common issues](#common-issues)
6. [Deploying to a HF Space](#deploying-to-a-hf-space)
7. [Building](#building)
8. [Config changes for HuggingChat](#config-changes-for-huggingchat)
9. [Populate database](#populate-database)
10. [Building the docker images locally](#building-the-docker-images-locally)

> Note on models in this build: This branch only supports OpenAI-compatible APIs via `OPENAI_BASE_URL` and the `/models` endpoint. The legacy `MODELS` env var, GGUF discovery, llama.cpp/TGI/Ollama/provider-specific endpoints, and embedding/web-search features are removed.

## Quickstart

### Docker image

You can deploy a chat-ui instance in a single command using the docker image. Get your Hugging Face token from [here](https://huggingface.co/settings/tokens) if you plan to use the HF router.

```bash
docker run \
  -p 3000 \
  -e MONGODB_URL=mongodb://host.docker.internal:27017 \
  -e OPENAI_BASE_URL=https://router.huggingface.co/v1 \
  -e HF_TOKEN=hf_*** \
  -v db:/data \
  ghcr.io/huggingface/chat-ui-db:latest
```

Take a look at the [`.env` file](https://github.com/huggingface/chat-ui/blob/main/.env) for all environment variables. In this build, only OpenAI-compatible endpoints are supported via `OPENAI_BASE_URL` and `OPENAI_API_KEY` (or `HF_TOKEN`). Other providers are not available.

### Local setup

Note: This build is OpenAI-compatible only. Local llama.cpp, TGI, Ollama and other provider endpoints are disabled.

**Step 1 (make sure you have MongoDB running locally):**

```bash
docker run -d -p 27017:27017 --name mongo-chatui mongo:latest
```

Read more [here](#database).

**Step 2 (clone chat-ui):**

```bash
git clone https://github.com/huggingface/chat-ui
cd chat-ui
```

**Step 3 (start chat-ui):**

```bash
npm install
npm run dev -- --open
```

Read more [here](#launch).

## No Setup Deploy

If you don't want to configure, setup, and launch your own Chat UI yourself, you can use this option as a fast deploy alternative.

You can deploy your own customized Chat UI instance with any supported [LLM](https://huggingface.co/models?pipeline_tag=text-generation&sort=trending) of your choice on [Hugging Face Spaces](https://huggingface.co/spaces). To do so, use the chat-ui template [available here](https://huggingface.co/new-space?template=huggingchat/chat-ui-template).

Set `OPENAI_BASE_URL` (for example `https://router.huggingface.co/v1`) and optionally `HF_TOKEN` in [Space secrets](https://huggingface.co/docs/hub/spaces-overview#managing-secrets). `HF_TOKEN` is recommended when using the Hugging Face router, and `OPENAI_API_KEY` can be used for other OpenAI-compatible providers. Make sure to create your personal token first in your [User Access Tokens settings](https://huggingface.co/settings/tokens).

Read the full tutorial [here](https://huggingface.co/docs/hub/spaces-sdks-docker-chatui#chatui-on-spaces).

## Setup

The default config for Chat UI is stored in the `.env` file. You will need to override some values to get Chat UI to run locally. This is done in `.env.local`.

Start by creating a `.env.local` file in the root of the repository. The bare minimum config you need to get Chat UI to run locally is the following:

```env
MONGODB_URL=<the URL to your MongoDB instance>
OPENAI_BASE_URL=<OpenAI-compatible API base URL, e.g. https://router.huggingface.co/v1>
# One of the following for authorization (prefer HF_TOKEN with Hugging Face router):
HF_TOKEN=<your HF access token>
# or
OPENAI_API_KEY=<your provider API key>
```

### Database

The chat history is stored in a MongoDB instance, and having a DB instance available is needed for Chat UI to work.

You can use a local MongoDB instance. The easiest way is to spin one up using docker:

```bash
docker run -d -p 27017:27017 --name mongo-chatui mongo:latest
```

In which case the url of your DB will be `MONGODB_URL=mongodb://localhost:27017`.

Alternatively, you can use a [free MongoDB Atlas](https://www.mongodb.com/pricing) instance for this, Chat UI should fit comfortably within their free tier. After which you can set the `MONGODB_URL` variable in `.env.local` to match your instance.

### Hugging Face Access Token

If you use the Hugging Face router, you will need a Hugging Face access token to run Chat UI locally. You can get one from [your Hugging Face profile](https://huggingface.co/settings/tokens).

## Launch

After you're done with the `.env.local` file you can run Chat UI locally with:

```bash
npm install
npm run dev
```

## Extra parameters

### OpenID connect

The login feature is disabled by default and users are attributed a unique ID based on their browser. But if you want to use OpenID to authenticate your users, you can add the following to your `.env.local` file:

```env
OPENID_CONFIG=`{
  PROVIDER_URL: "<your OIDC issuer>",
  CLIENT_ID: "<your OIDC client ID>",
  CLIENT_SECRET: "<your OIDC client secret>",
  SCOPES: "openid profile",
  TOLERANCE: // optional
  RESOURCE: // optional
}`
```

These variables will enable the openID sign-in modal for users.

### Trusted header authentication

You can set the env variable `TRUSTED_EMAIL_HEADER` to point to the header that contains the user's email address. This will allow you to authenticate users from the header. This setup is usually combined with a proxy that will be in front of chat-ui and will handle the auth and set the header.

> [!WARNING]
> Make sure to only allow requests to chat-ui through your proxy which handles authentication, otherwise users could authenticate as anyone by setting the header manually! Only set this up if you understand the implications and know how to do it correctly.

Here is a list of header names for common auth providers:

- Tailscale Serve: `Tailscale-User-Login`
- Cloudflare Access: `Cf-Access-Authenticated-User-Email`
- oauth2-proxy: `X-Forwarded-Email`

### Theming

You can use a few environment variables to customize the look and feel of chat-ui. These are by default:

```env
PUBLIC_APP_NAME=ChatUI
PUBLIC_APP_ASSETS=chatui
PUBLIC_APP_COLOR=blue
PUBLIC_APP_DESCRIPTION="Making the community's best AI chat models available to everyone."
PUBLIC_APP_DATA_SHARING=
PUBLIC_APP_DISCLAIMER=
```

- `PUBLIC_APP_NAME` The name used as a title throughout the app.
- `PUBLIC_APP_ASSETS` Is used to find logos & favicons in `static/$PUBLIC_APP_ASSETS`, current options are `chatui` and `huggingchat`.
- `PUBLIC_APP_COLOR` Can be any of the [tailwind colors](https://tailwindcss.com/docs/customizing-colors#default-color-palette).
- `PUBLIC_APP_DATA_SHARING` Can be set to 1 to add a toggle in the user settings that lets your users opt-in to data sharing with models creator.
- `PUBLIC_APP_DISCLAIMER` If set to 1, we show a disclaimer about generated outputs on login.

### Models

This build does not use the `MODELS` env var or GGUF discovery. Configure models via `OPENAI_BASE_URL` only; Chat UI will fetch `${OPENAI_BASE_URL}/models` and populate the list automatically. Authorization uses `HF_TOKEN` (preferred for the HF router) or `OPENAI_API_KEY`.

## Common issues

### 403：You don't have access to this conversation

Most likely you are running chat-ui over HTTP. The recommended option is to setup something like NGINX to handle HTTPS and proxy the requests to chat-ui. If you really need to run over HTTP you can add `COOKIE_SECURE=false` and `COOKIE_SAMESITE=lax` to your `.env.local`.

Make sure to set your `PUBLIC_ORIGIN` in your `.env.local` to the correct URL as well.

## Deploying to a HF Space

Create a `DOTENV_LOCAL` secret to your HF space with the content of your .env.local, and they will be picked up automatically when you run.

Ensure the secret includes at least: `MONGODB_URL` and `OPENAI_BASE_URL`. Add `HF_TOKEN` or `OPENAI_API_KEY` depending on your provider.

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://kit.svelte.dev/docs/adapters) for your target environment.

## Config changes for HuggingChat

The config file for HuggingChat is stored in the `chart/env/prod.yaml` file. It is the source of truth for the environment variables used for our CI/CD pipeline. For HuggingChat, as we need to customize the app color, as well as the base path, we build a custom docker image. You can find the workflow here.

> [!TIP]
> If you want to make changes to the model config used in production for HuggingChat, you should do so against `chart/env/prod.yaml`.

### Running a copy of HuggingChat locally

If you want to run an exact copy of HuggingChat locally, you will need to do the following first:

1. Create an [OAuth App on the hub](https://huggingface.co/settings/applications/new) with `openid profile email` permissions. Make sure to set the callback URL to something like `http://localhost:5173/chat/login/callback` which matches the right path for your local instance.
2. Create a [HF Token](https://huggingface.co/settings/tokens) with your Hugging Face account. You will need a Pro account to be able to access some of the larger models available through HuggingChat.
3. Run an instance of mongoDB, however you want. (Local or remote)

You can then create a new `.env.SECRET_CONFIG` file with the following content

```env
MONGODB_URL=<link to your mongo DB from step 3>
HF_TOKEN=<your HF token from step 2>
OPENAI_BASE_URL=https://router.huggingface.co/v1
OPENID_CONFIG=`{
  PROVIDER_URL: "https://huggingface.co",
  CLIENT_ID: "<your client ID from step 1>",
  CLIENT_SECRET: "<your client secret from step 1>",
}`
MESSAGES_BEFORE_LOGIN=<can be any numerical value, or set to 0 to require login>
```

You can then run `npm run updateLocalEnv` in the root of chat-ui. This will create a `.env.local` file which combines the `chart/env/prod.yaml` and the `.env.SECRET_CONFIG` file. You can then run `npm run dev` to start your local instance of HuggingChat.

## Populate database

> [!WARNING]
> The `MONGODB_URL` used for this script will be fetched from `.env.local`. Make sure it's correct! The command runs directly on the database.

You can populate the database using faker data using the `populate` script:

```bash
npm run populate <flags here>
```

At least one flag must be specified, the following flags are available:

- `reset` - resets the database
- `all` - populates all tables
- `users` - populates the users table
- `settings` - populates the settings table for existing users
- `assistants` - populates the assistants table for existing users
- `conversations` - populates the conversations table for existing users

For example, you could use it like so:

```bash
npm run populate reset
```

to clear out the database. Then login in the app to create your user and run the following command:

```bash
npm run populate users settings assistants conversations
```

to populate the database with fake data, including fake conversations and assistants for your user.

## Building the docker images locally

You can build the docker images locally using the following commands:

```bash
docker build -t chat-ui-db:latest --build-arg INCLUDE_DB=true .
docker build -t chat-ui:latest --build-arg INCLUDE_DB=false .
docker build -t huggingchat:latest --build-arg INCLUDE_DB=false --build-arg APP_BASE=/chat --build-arg PUBLIC_APP_COLOR=yellow --build-arg SKIP_LLAMA_CPP_BUILD=true .
```

If you want to run the images with your local .env.local you have two options

```bash
DOTENV_LOCAL=$(<.env.local)  docker run --network=host -e DOTENV_LOCAL chat-ui-db
```

```bash
docker run --network=host --mount type=bind,source="$(pwd)/.env.local",target=/app/.env.local chat-ui-db
```

