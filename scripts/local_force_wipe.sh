#!/bin/bash

pkill -f llama-server

# Start the Docker containers
cd "$(dirname "$0")/.."
docker-compose down --volumes   # Also remove volumes