ARG INCLUDE_DB=false
FROM mongo:latest as mongo

FROM node:20-slim as local_db_false

FROM node:20-slim as local_db_true

RUN apt-get update
RUN apt-get install gnupg curl -y

COPY --from=mongo /usr/bin/mongo* /usr/bin/

FROM local_db_${INCLUDE_DB} as final
ARG INCLUDE_DB=false
ENV INCLUDE_DB=${INCLUDE_DB}

WORKDIR /app

COPY --link --chown=1000 package-lock.json package.json ./
RUN --mount=type=cache,target=/app/.npm \
        npm set cache /app/.npm && \
        npm ci 

# copy the rest of the files, run regardless of
COPY --chown=1000 --link . .
RUN chmod +x /app/entrypoint.sh

CMD ["/bin/bash", "-c", "/app/entrypoint.sh"]