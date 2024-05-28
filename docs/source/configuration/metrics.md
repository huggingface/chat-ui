# Metrics

The server exposes prometheus metrics on port `5565` by default. You may disable the metrics server with `METRICS_ENABLED=false` and change the port with `METRICS_PORT=1234`.

<Tip>

In development with `npm run dev`, the metrics server does not shutdown gracefully due to Sveltekit not providing hooks for restart. It's recommended to disable the metrics server in this case.

</Tip>
