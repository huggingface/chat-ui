if test -z "${DOTENV_LOCAL}" ; then
    if ! test -f "/app/config/.env.local" ; then
        echo "DOTENV_LOCAL was not found in the ENV variables and .env.local is not set using a bind volume, exiting."
        exit 1
    fi;
else
    echo "DOTENV_LOCAL was found in the ENV variables. Creating config/.env.local file."
    cat <<< "$DOTENV_LOCAL" > /app/config/.env.local
fi;

npm run build

pm2 start /app/build/index.js --no-daemon