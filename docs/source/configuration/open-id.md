# OpenID

The login feature is disabled by default and users are attributed a unique ID based on their browser. But if you want to use OpenID to authenticate your users, you can add the following to your `.env.local` file:

```ini
OPENID_CONFIG=`{
  PROVIDER_URL: "<your OIDC issuer>",
  CLIENT_ID: "<your OIDC client ID>",
  CLIENT_SECRET: "<your OIDC client secret>",
  SCOPES: "openid profile",
  TOLERANCE: // optional
  RESOURCE: // optional
}`
```

Redirect URI: `/login/callback`
