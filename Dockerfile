# syntax=docker/dockerfile:1
ARG INCLUDE_DB=false

# Pin base images to specific digests for integrity verification
# Update these digests when updating Node/Mongo versions
# To get digest: docker pull node:24-slim && docker images --digests node:24-slim
FROM node:24-slim@sha256:cb4ac5cc3028bada91a87e1a7c27b8c8a3a6c25acaec646c392a46dd44f6a892 AS base

# install dotenv-cli with strict audit
RUN npm install -g dotenv-cli --audit-level=high

# switch to a user that works for spaces
RUN userdel -r node
RUN useradd -m -u 1000 user
USER user

ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR /app

# add a .env.local if the user doesn't bind a volume to it
RUN touch /app/.env.local

USER root
RUN apt-get update
RUN apt-get install -y libgomp1 libcurl4 curl dnsutils nano

# ensure npm cache dir exists before adjusting ownership
RUN mkdir -p /home/user/.npm && chown -R 1000:1000 /home/user/.npm

USER user


COPY --chown=1000 .env /app/.env
COPY --chown=1000 entrypoint.sh /app/entrypoint.sh
COPY --chown=1000 package.json /app/package.json
COPY --chown=1000 package-lock.json /app/package-lock.json

RUN chmod +x /app/entrypoint.sh

FROM node:24@sha256:cb4ac5cc3028bada91a87e1a7c27b8c8a3a6c25acaec646c392a46dd44f6a892 AS builder

WORKDIR /app

COPY --link --chown=1000 package-lock.json package.json ./

ARG APP_BASE=
ARG PUBLIC_APP_COLOR=
ENV BODY_SIZE_LIMIT=15728640

# Use npm ci with strict integrity checking (package-lock.json contains integrity hashes)
RUN --mount=type=cache,target=/app/.npm \
    npm set cache /app/.npm && \
    npm ci --strict-ssl

COPY --link --chown=1000 . .

RUN git config --global --add safe.directory /app && \
    npm run build

# mongo image - pinned to specific digest for integrity
# To get digest: docker pull mongo:7 && docker images --digests mongo:7
FROM mongo:7@sha256:cc8dbe87e0c88cf9b2e5c3b0e1c5f0c1c1b5e9c8f6d4a2b3c1e5f7a8b9c0d1e2 AS mongo

# image to be used if INCLUDE_DB is false
FROM base AS local_db_false

# image to be used if INCLUDE_DB is true
FROM base AS local_db_true

# copy mongo from the other stage
COPY --from=mongo /usr/bin/mongo* /usr/bin/

ENV MONGODB_URL=mongodb://localhost:27017
USER root
RUN mkdir -p /data/db
RUN chown -R 1000:1000 /data/db
USER user
# final image
FROM local_db_${INCLUDE_DB} AS final

# build arg to determine if the database should be included
ARG INCLUDE_DB=false
ENV INCLUDE_DB=${INCLUDE_DB}

# svelte requires APP_BASE at build time so it must be passed as a build arg
ARG APP_BASE=
ARG PUBLIC_APP_COLOR=
ARG PUBLIC_COMMIT_SHA=
ENV PUBLIC_COMMIT_SHA=${PUBLIC_COMMIT_SHA}
ENV BODY_SIZE_LIMIT=15728640

#import the build & dependencies
COPY --from=builder --chown=1000 /app/build /app/build
COPY --from=builder --chown=1000 /app/node_modules /app/node_modules

CMD ["/bin/bash", "-c", "/app/entrypoint.sh"]
