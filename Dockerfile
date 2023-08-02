# read the doc: https://huggingface.co/docs/hub/spaces-sdks-docker
# you will also find guides on how best to write your Dockerfile
# This Dockerfile builds a production image for a Node.js application.

FROM node:19 as builder-production

# Set the working directory.
WORKDIR /app

# Copy the package.json and package-lock.json files to the working directory.
COPY --link --chown=1000 package-lock.json package.json ./

# Create a cache directory for npm packages.
# Splitting the command into three separate steps makes the Dockerfile easier to read and understand. It also makes it easier to debug the build process, if something goes wrong.

# Create a cache directory for npm packages:
RUN --mount=type=cache,target=/app/.npm \
        npm set cache /app/.npm

# It is best practice to set the cache location twice. This ensures that the cache location is set correctly, even if something goes wrong during the build process.
RUN --mount=type=cache,target=/app/.npm \
        npm set cache /app/.npm
        
# Install the dependencies.
RUN --mount=type=cache,target=/app/.npm \
        npm ci --omit=dev
        
# This is the second stage of the build.
FROM builder-production as builder

# Install the dependencies again, even though they were already installed in the
# first stage. This is because the `npm ci` command in the first stage only
# installs the dependencies that are listed in the `package-lock.json` file.
# If you make changes to the `package.json` file, you will need to run `npm ci`
# again in the second stage to install the new dependencies.
RUN --mount=type=cache,target=/app/.npm \
        npm set cache /app/.npm && \
        npm ci

# Copy the rest of the application files to the working directory.
COPY --link --chown=1000 . .

# Splitting the commands into two separate steps makes the Dockerfile easier to read and understand. It also makes it easier to debug the build process, if something goes wrong.
# Create a secret environment variable for the `.env.local` file.
RUN --mount=type=secret,id=DOTENV_LOCAL,dst=.env.local

# Build the application.
RUN npm run build

# This is the third and final stage of the build.
FROM node:19-slim

# Install PM2.
RUN npm install -g pm2

# Copy the node_modules directory from the builder image.
COPY --from=builder-production /app/node_modules /app/node_modules

# Copy the package.json file from the builder image.
COPY --link --chown=1000 package.json /app/package.json

# Copy the build directory from the builder image.
COPY --from=builder /app/build /app/build

# Start the application.
CMD pm2 start /app/build/index.js -i $CPU_CORES --no-daemon
