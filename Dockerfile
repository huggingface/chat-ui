# read the doc: https://huggingface.co/docs/hub/spaces-sdks-docker
# you will also find guides on how best to write your Dockerfile
# FROM node:19 as builder-production

# COPY . /app

# WORKDIR /app

# RUN npm set cache /app/.npm && \
#         npm ci --omit=dev

# FROM builder-production as builder

FROM shai-builder as builder

# RUN npm set cache /app/.npm && \
#         npm ci

COPY .env.local .env.local
COPY src src
# COPY package.json package.json

# RUN npm run build
# RUN npm install

CMD npm run dev

# FROM node:19-slim

# RUN npm install

# COPY --from=builder /app/node_modules /app/node_modules
# COPY --link --chown=1000 package.json /app/package.json
# COPY --from=builder /app/build /app/build

# CMD npm run dev