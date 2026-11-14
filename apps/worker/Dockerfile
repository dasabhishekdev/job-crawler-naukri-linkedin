# Base image version must match the "playwright" dependency so its bundled Chromium is used.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

ENV DEBIAN_FRONTEND=noninteractive NODE_ENV=production TZ=Asia/Kolkata PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

RUN apt-get update && apt-get install -y -qq --no-install-recommends tzdata fonts-crosextra-carlito \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/* \
    && node -e "const [a,b]=process.versions.node.split('.').map(Number);if(!(a>22||(a===22&&b>=13))){console.error('Node >= 22.13 required, got '+process.version);process.exit(1)}"

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ai/package.json packages/ai/
COPY packages/google/package.json packages/google/
COPY packages/portals/package.json packages/portals/
COPY apps/worker/package.json apps/worker/
RUN npm ci --workspace=@jobportal/worker --include-workspace-root --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY packages ./packages
COPY apps/worker ./apps/worker

RUN mkdir -p /app/data && chown -R pwuser:pwuser /app/data
USER pwuser
ENV DATA_DIR=/app/data HOME=/home/pwuser
WORKDIR /app/apps/worker
CMD ["node", "src/index.js"]
