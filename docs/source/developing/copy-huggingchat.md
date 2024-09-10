# Copy HuggingChat

The config file for HuggingChat is stored in the `chart/env/prod.yaml` file. It is the source of truth for the environment variables used for our CI/CD pipeline. For HuggingChat, as we need to customize the app color, as well as the base path, we build a custom docker image. You can find the workflow here.

<Tip>

If you want to make changes to the model config used in production for HuggingChat, you should do so against `chart/env/prod.yaml`.

</Tip>

### Running a copy of HuggingChat locally

If you want to run an exact copy of HuggingChat locally, you will need to do the following first:

1. Create an [OAuth App on the hub](https://huggingface.co/settings/applications/new) with `openid profile email` permissions. Make sure to set the callback URL to something like `http://localhost:5173/chat/login/callback` which matches the right path for your local instance.
2. Create a [HF Token](https://huggingface.co/settings/tokens) with your Hugging Face account. You will need a Pro account to be able to access some of the larger models available through HuggingChat.
3. Create a free account with [serper.dev](https://serper.dev/) (you will get 2500 free search queries)
4. Run an instance of MongoDB, however you want. (Local or remote)

You can then create a new `.env.SECRET_CONFIG` file with the following content

```ini
MONGODB_URL=<link to your mongo DB from step 4>
HF_TOKEN=<your HF token from step 2>
OPENID_CONFIG=`{
  PROVIDER_URL: "https://huggingface.co",
  CLIENT_ID: "<your client ID from step 1>",
  CLIENT_SECRET: "<your client secret from step 1>",
}`
SERPER_API_KEY=<your serper API key from step 3>
MESSAGES_BEFORE_LOGIN=<can be any numerical value, or set to 0 to require login>
```

You can then run `npm run updateLocalEnv` in the root of chat-ui. This will create a `.env.local` file which combines the `chart/env/prod.yaml` and the `.env.SECRET_CONFIG` file. You can then run `npm run dev` to start your local instance of HuggingChat.

### Populate database

<Tip warning={true}>

The `MONGODB_URL` used for this script will be fetched from `.env.local`. Make sure it's correct! The command runs directly on the database.

</Tip>

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
