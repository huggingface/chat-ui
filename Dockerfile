# read the doc: https://huggingface.co/docs/hub/spaces-sdks-docker
# you will also find guides on how best to write your Dockerfile

FROM node:19

RUN npm install -g pm2

WORKDIR /app

COPY --link --chown=1000 package.json package.json
COPY --link --chown=1000 package-lock.json package-lock.json

RUN npm i

COPY --link --chown=1000 . .

CMD cat $DOTENV_LOCAL > .env.local && npm run build && pm2 start build/index.js -i $CPU_CORES --no-daemon
