# read the doc: https://huggingface.co/docs/hub/spaces-sdks-docker
# you will also find guides on how best to write your Dockerfile

FROM node:19

WORKDIR /app

COPY . .

RUN npm i

RUN chown -R 1000:1000 /app

RUN --mount=type=secret,id=PUBLIC_MODEL_ENDPOINT,mode=0444,required=true \
   PUBLIC_MODEL_ENDPOINT=$(cat /run/secrets/PUBLIC_MODEL_ENDPOINT) npm run build

ENV PORT 7860

CMD ["node", "build"]
