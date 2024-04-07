# syntax=docker/dockerfile:1
# read the doc: https://huggingface.co/docs/hub/spaces-sdks-docker
# you will also find guides on how best to write your Dockerfile
FROM node:20 as builder-production

WORKDIR /app

COPY --link --chown=1000 package-lock.json package.json ./
RUN --mount=type=cache,target=/app/.npm \
        npm set cache /app/.npm && \
        npm ci --omit=dev

FROM builder-production as builder

RUN --mount=type=cache,target=/app/.npm \
        npm set cache /app/.npm && \
        npm ci

COPY --link --chown=1000 . .

ARG APP_BASE
ENV APP_BASE=${APP_BASE}

RUN npm run build

FROM node:20-slim

WORKDIR /app

RUN npm install -g pm2 dotenv-cli

COPY --from=builder-production /app/node_modules /app/node_modules
COPY --link --chown=1000 package.json /app/package.json
COPY --from=builder /app/build /app/build

CMD dotenv -e .env -c -- pm2 start /app/build/index.js -i $CPU_CORES --no-daemon
