FROM node:24-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV ML_ASSISTANT_MODE=true
RUN npm run build

FROM mongo:7 AS mongo

FROM node:24-bookworm-slim
COPY --from=mongo /usr/bin/mongod /usr/local/bin/mongod
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini libcurl4 libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder --chown=node:node /app/build ./build
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json server.js .env ./
COPY --chown=node:node integrations/slack/space/start.mjs integrations/slack/space/state.mjs ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=7860 BODY_SIZE_LIMIT=15728640
USER node
EXPOSE 7860
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "start.mjs"]
