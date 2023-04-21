# read the doc: https://huggingface.co/docs/hub/spaces-sdks-docker
# you will also find guides on how best to write your Dockerfile

FROM node:19

RUN npm install -g pm2

WORKDIR /app

COPY . .

RUN npm i

RUN chown -R 1000:1000 /app

RUN --mount=type=secret,id=DOTENV_LOCAL,mode=0444,required=true cat /run/secrets/DOTENV_LOCAL > .env.local
   
RUN npm run build

ENV PORT 7860

CMD ["pm2", "start", "build/index.js" ,"-i", "2", "--no-daemon"]
