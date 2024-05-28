# Configuration Overview

Chat UI handles configuration with environment variables. The default config for Chat UI is stored in the `.env` file, which you may use as a reference. You will need to override some values to get Chat UI to run locally. This can be done in `.env.local` or via your environment. The bare minimum configuration to get Chat UI running is:

```ini
MONGODB_URL=mongodb://localhost:27017
HF_TOKEN=your_token
```

The following sections detail various sections of the app you may want to configure.
