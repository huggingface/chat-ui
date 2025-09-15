#!/bin/bash

pkill -f llama-server

# Start the Docker containers
cd "$(dirname "$0")/.."

docker volume rm mongo_data --force
docker volume rm llama_cache --force
docker volume create mongo_data
docker volume create llama_cache

docker-compose kill