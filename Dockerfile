FROM node:19

WORKDIR /app

COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
COPY src/ /app/src
COPY static/ /app/static
COPY .env /app/.env 
COPY .env.local /app/.env.local
COPY postcss.config.js /app/postcss.config.js
COPY svelte.config.js /app/svelte.config.js
COPY tailwind.config.cjs /app/tailwind.config.cjs
COPY tsconfig.json /app/tsconfig.json
COPY vite.config.ts /app/vite.config.ts
COPY PRIVACY.md /app/PRIVACY.md
COPY PROMPTS.md /app/PROMPTS.md
COPY update_env.py /app/update_env.py
COPY .npmrc /app/.npmrc

RUN npm install
RUN npm run build


CMD ["npm", "start"]
