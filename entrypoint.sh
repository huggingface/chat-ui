ENV_LOCAL_PATH=/app/.env.local

if test -z "${DOTENV_LOCAL}" ; then
    if ! test -f "${ENV_LOCAL_PATH}" ; then
        echo "DOTENV_LOCAL was not found in the ENV variables and .env.local is not set using a bind volume. Make sure to set environment variables properly. "
    fi;
else
    echo "DOTENV_LOCAL was found in the ENV variables. Creating .env.local file."
    cat <<< "$DOTENV_LOCAL" > ${ENV_LOCAL_PATH}
fi;

if [ "$INCLUDE_DB" = "true" ] ; then
    echo "Starting local MongoDB instance"
    nohup mongod &
fi;

export PUBLIC_VERSION=$(node -p "require('./package.json').version")

# Load .env / .env.local first, then mirror PUBLIC_ORIGIN -> ORIGIN for adapter-node (#2489).
# SvelteKit's node adapter forces https:// for page.url.origin unless ORIGIN is set.
dotenv -e /app/.env -c -- bash -c '
if [ -z "$ORIGIN" ] && [ -n "$PUBLIC_ORIGIN" ]; then
    export ORIGIN="$PUBLIC_ORIGIN"
fi
[ -n "$ORIGIN" ] && export ORIGIN="${ORIGIN%/}"
exec node --dns-result-order=ipv4first /app/server.js
'
