#!/bin/bash

pkill -f llama-server

# Default: no build
DOCKER_BUILD_FLAG=""

# Check if --build was passed as an argument
for arg in "$@"; do
    if [[ "$arg" == "--build" ]]; then
        echo "Re-building Docker images..."
        DOCKER_BUILD_FLAG="--build"
    fi
done

declare -A LLMS
LLMS[1]="--hf-repo microsoft/Phi-3-mini-4k-instruct-gguf --hf-file Phi-3-mini-4k-instruct-q4.gguf -c 4096 --port 8081"
LLMS[2]="-hf NousResearch/Hermes-3-Llama-3.1-8B-GGUF:Q4_K_M -c 4096 --port 8082"
LLMS[3]="-hf unsloth/gpt-oss-20b-GGUF:Q4_K_M -c 4096 --port 8083"
LLMS[4]="-hf bartowski/Mistral-Nemo-Instruct-2407-GGUF:Q6_K -c 4096 --port 8084"
LLMS[5]="-hf UnfilteredAI/DAN-L3-R1-8B:F16 -c 4096 --port 8085"

echo "Available LLMs:"
for i in "${!LLMS[@]}"; do
    echo "$i) ${LLMS[$i]}"
done

read -p "Enter two LLM numbers to run (e.g., 1 3): " LLM1 LLM2

for idx in $LLM1 $LLM2; do
    echo "Starting LLM $idx..."
    llama-server ${LLMS[$idx]} &
done

# Start the Docker containers
cd "$(dirname "$0")/.."
docker-compose up $DOCKER_BUILD_FLAG -d &