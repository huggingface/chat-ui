ENV_LOCAL_PATH=/app/.env.local

if test -z "${DOTENV_LOCAL}" ; then
    if ! test -f "${ENV_LOCAL_PATH}" ; then
        echo "DOTENV_LOCAL was not found in the ENV variables and .env.local is not set using a bind volume. We are using the default .env config."
    fi;
else
    echo "DOTENV_LOCAL was found in the ENV variables. Creating .env.local file."
    cat <<< "$DOTENV_LOCAL" > ${ENV_LOCAL_PATH}
fi;

if [ "$INCLUDE_DB" = "true" ] ; then
    echo "INCLUDE_DB is set to true."

    MONGODB_CONFIG="MONGODB_URL=mongodb://localhost:27017"
    if ! grep -q "^${MONGODB_CONFIG}$" ${ENV_LOCAL_PATH}; then
      echo "Appending MONGODB_URL"
      touch /app/.env.local
      echo -e "\n${MONGODB_CONFIG}" >> ${ENV_LOCAL_PATH}
    fi

    mkdir -p /data/db
    mongod &
    echo "Starting local MongoDB instance"

fi;

npm run build
npm run preview -- --host 0.0.0.0 --port 3000