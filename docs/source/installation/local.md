# Running Locally

You may start an instance locally for non-production use cases. For production use cases, please see the other installation options.

## Configuration

The default config for Chat UI is stored in the `.env` file. You will need to override some values to get Chat UI to run locally. Start by creating a `.env.local` file in the root of the repository as per the [configuration section](../configuration/overview). The bare minimum config you need to get Chat UI to run locally is the following:

```ini
MONGODB_URL=<the URL to your MongoDB instance>
HF_TOKEN=<your access token> # find your token at hf.co/settings/token
```

## Database

The chat history is stored in a MongoDB instance, and having a DB instance available is needed for Chat UI to work.

You can use a local MongoDB instance. The easiest way is to spin one up using docker with persistence:

```bash
docker run -d -p 27017:27017 -v mongo-chat-ui:/data --name mongo-chat-ui mongo:latest
```

In which case the url of your DB will be `MONGODB_URL=mongodb://localhost:27017`.

Alternatively, you can use a [free MongoDB Atlas](https://www.mongodb.com/pricing) instance for this, Chat UI should fit comfortably within their free tier. After which you can set the `MONGODB_URL` variable in `.env.local` to match your instance.

## Starting the server

```bash
npm ci # install dependencies
npm run build # build the project
npm run preview -- --open # start the server with & open your instance at http://localhost:4173
```
