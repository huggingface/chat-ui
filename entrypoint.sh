#!/bin/bash
set -e  # Exit on error

ENV_LOCAL_PATH=/app/.env.local
PLACEHOLDER="/__PLACEHOLDER__"

# Handle DOTENV_LOCAL env variable
if test -z "${DOTENV_LOCAL}" ; then
    if ! test -f "${ENV_LOCAL_PATH}" ; then
        echo "WARNING: DOTENV_LOCAL was not found in the ENV variables and .env.local is not set using a bind volume."
    fi
else
    echo "Creating .env.local from DOTENV_LOCAL environment variable"
    cat <<< "$DOTENV_LOCAL" > ${ENV_LOCAL_PATH}
fi

# Start MongoDB if included
if [ "$INCLUDE_DB" = "true" ] ; then
    echo "Starting local MongoDB instance"
    nohup mongod &
fi

# Inject APP_BASE using sed (no rebuild needed)
APP_BASE_NO_SLASH="${APP_BASE#/}"

if [ -n "$APP_BASE" ]; then
    echo "Injecting APP_BASE='${APP_BASE}' into built files..."
    
    # Handle nested paths (e.g., /level1/level2)
    if [ -d "/app/build/client/__PLACEHOLDER__" ]; then
        TARGET_DIR="/app/build/client/${APP_BASE_NO_SLASH}"
        PARENT_DIR=$(dirname "$TARGET_DIR")
        
        # Create parent directories if path has multiple segments
        if [ "$PARENT_DIR" != "/app/build/client" ]; then
            mkdir -p "$PARENT_DIR"
            echo "  Created parent directories: $PARENT_DIR"
        fi
        
        mv /app/build/client/__PLACEHOLDER__ "$TARGET_DIR"
        echo "  Moved client assets to ${APP_BASE_NO_SLASH}"
    fi
    
    # Replace placeholder in all built files
    find /app/build -type f \( -name "*.js" -o -name "*.html" -o -name "*.css" \) \
        -exec sed -i "s|${PLACEHOLDER}|${APP_BASE}|g" {} + 2>/dev/null || true
    
    find /app/build -type f -name "*.js" \
        -exec sed -i "s|__PLACEHOLDER__|${APP_BASE_NO_SLASH}|g" {} + 2>/dev/null || true
    
    echo "Path injection complete"
else
    # Root path - remove placeholder
    echo "Configuring for root path..."
    
    if [ -d "/app/build/client/__PLACEHOLDER__" ]; then
        mv /app/build/client/__PLACEHOLDER__/* /app/build/client/ 2>/dev/null || true
        rmdir /app/build/client/__PLACEHOLDER__ 2>/dev/null || true
        echo "  Moved client assets to root"
    fi
    
    find /app/build -type f \( -name "*.js" -o -name "*.html" -o -name "*.css" \) \
        -exec sed -i "s|${PLACEHOLDER}||g" {} + 2>/dev/null || true
    
    find /app/build -type f -name "*.js" \
        -exec sed -i "s|__PLACEHOLDER__/||g" {} + 2>/dev/null || true
    
    echo "Root path configuration complete"
fi

export PUBLIC_VERSION=$(node -p "require('./package.json').version")

echo "Starting Chat UI on port 3000..."
dotenv -e /app/.env -c -- node --dns-result-order=ipv4first /app/build/index.js -- --host 0.0.0.0 --port 3000
