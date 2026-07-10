FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/

RUN npm install --workspace=@jobportal/api --include-workspace-root

COPY packages ./packages
COPY apps/api ./apps/api
COPY config ./config

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["npm", "start"]
