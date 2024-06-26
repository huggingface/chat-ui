#!/bin/sh

# Get the latest git commit SHA
COMMIT_SHA=$(git rev-parse HEAD)

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg INCLUDE_DB=false \
  --build-arg APP_BASE= \
  --build-arg PUBLIC_APP_COLOR=blue \
  --build-arg GIT_COMMIT=$COMMIT_SHA \
  -t jakelevirne/duckyfoo-chat:latest \
  -t jakelevirne/duckyfoo-chat:$COMMIT_SHA \
  --push \
  .