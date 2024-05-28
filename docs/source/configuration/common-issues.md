# Common Issues

## 403：You don't have access to this conversation

Most likely you are running chat-ui over HTTP. The recommended option is to setup something like NGINX to handle HTTPS and proxy the requests to chat-ui. If you really need to run over HTTP you can add `ALLOW_INSECURE_COOKIES=true` to your `.env.local`.

Make sure to set your `PUBLIC_ORIGIN` in your `.env.local` to the correct URL as well.
