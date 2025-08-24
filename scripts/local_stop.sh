#!/bin/bash

pkill -f llama-server

# Start the Docker containers
cd "$(dirname "$0")/.."
docker-compose stop