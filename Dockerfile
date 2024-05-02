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

RUN --mount=type=secret,id=DOTENV_LOCAL,dst=.env.local \
    npm run build

FROM node:20-slim
RUN npm install -g pm2

RUN userdel -r node

RUN useradd -m -u 1000 user

USER user

ENV HOME=/home/user \
	PATH=/home/user/.local/bin:$PATH


COPY --from=builder-production --chown=1000 /app/node_modules /app/node_modules
COPY --link --chown=1000 package.json /app/package.json
COPY --from=builder --chown=1000 /app/build /app/build
COPY --chown=1000 gcp-*.json /app/

CMD pm2 start /app/build/index.js -i $CPU_CORES --no-daemon
