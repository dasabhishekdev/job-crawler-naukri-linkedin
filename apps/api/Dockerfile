FROM node:22-bookworm-slim

ENV NODE_ENV=production TZ=Asia/Kolkata
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ai/package.json packages/ai/
COPY packages/google/package.json packages/google/
COPY packages/portals/package.json packages/portals/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace=@jobportal/api --include-workspace-root --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY packages ./packages
COPY apps/api ./apps/api

RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV DATA_DIR=/app/data
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
