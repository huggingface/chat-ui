# read the doc: https://huggingface.co/docs/hub/spaces-sdks-docker
# you will also find guides on how best to write your Dockerfile

FROM node:19

RUN npm install -g pm2

WORKDIR /app

COPY . .

RUN npm i

RUN chown -R 1000:1000 /app

ENV PORT 7860

RUN --mount=type=secret,id=DOTENV_LOCAL,dst=.env.local npm run build

CMD pm2 start build/index.js -i $CPU_CORES --no-daemon
