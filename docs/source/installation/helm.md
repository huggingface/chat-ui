# Helm

<Tip warning={true}>

**We highly discourage using the chart**. The Helm chart is a work in progress and should be considered unstable. Breaking changes to the chart may be pushed without migration guides or notice. Contributions welcome!

</Tip>

For installation on Kubernetes, you may use the helm chart in `/chart`. Please note that no chart repository has been setup, so you'll need to clone the repository and install the chart by path. The production values may be found at `chart/env/prod.yaml`.

**Example values.yaml**

```yaml
replicas: 1

domain: example.com

service:
  type: ClusterIP

resources:
  requests:
    cpu: 100m
    memory: 2Gi
  limits:
    # Recommended to use large limits when web search is enabled
    cpu: "4"
    memory: 6Gi

envVars:
  MONGODB_URL: mongodb://chat-ui-mongo:27017
  # Ensure that your values.yaml will not leak anywhere
  # PRs welcome for a chart rework with envFrom support!
  HF_TOKEN: secret_token
```
