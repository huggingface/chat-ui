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
LLMS[6]="-hf Qwen/Qwen2.5-Coder-14B-Instruct-GGUF:Q4_K_M -c 4096 --port 8086"

echo "Available LLMs:"
for i in "${!LLMS[@]}"; do
    # remove everything before the first whitespace
    clean_args="${LLMS[$i]#* }"
    echo "$i) $clean_args"
done

read -p "Enter two LLM numbers to run (e.g., 1 3): " LLM1 LLM2
MODELS="["

for idx in $LLM1 $LLM2; do
    args=${LLMS[$idx]}
    
    # Extract port (assume port is the last argument)
    port="${args##* }"

    # Extract repo (after --hf-repo or -hf)
    repo=$(echo "$args" | sed -n 's/.*--hf-repo \([^ ]*\).*/\1/p')
    if [ -z "$repo" ]; then
        repo=$(echo "$args" | sed -n 's/.*-hf \([^ ]*\).*/\1/p')
    fi

    # Clean up repo name (remove suffix after ":" or ".")
    clean_repo=$(echo "$args" | awk '{print $2}')

    MODELS+="
    {
      \"name\": \"${clean_repo}\",
      \"endpoints\": [{
        \"type\": \"llamacpp\",
        \"baseURL\": \"http://host.docker.internal:${port}\"
      }]
    },"

    echo "Starting LLM $clean_repo..."
    llama-server $args &
done

# Remove trailing comma and close the array
MODELS="${MODELS%,}
]"
echo "Using MODELS: $MODELS"

# Start the Docker containers
cd "$(dirname "$0")/.."
MODELS=$MODELS docker-compose up $DOCKER_BUILD_FLAG -d &