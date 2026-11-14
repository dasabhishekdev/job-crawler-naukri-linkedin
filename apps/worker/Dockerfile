FROM mcr.microsoft.com/playwright:v1.61.1-jammy

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Kolkata
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

RUN apt-get update && apt-get install -y -qq tzdata build-essential python3 curl ca-certificates fonts-crosextra-carlito \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

# @cursor/sdk needs Node >= 22.13
RUN node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" \
    || (curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
        && apt-get install -y -qq nodejs \
        && rm -rf /var/lib/apt/lists/*)

COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/agent/package.json ./packages/agent/
COPY packages/google/package.json ./packages/google/
COPY apps/worker/package.json ./apps/worker/

RUN npm install --workspace=@jobportal/worker --include-workspace-root

COPY packages ./packages
COPY apps/worker ./apps/worker
COPY config ./config
COPY scripts/ensure-playwright-browsers.sh /app/scripts/ensure-playwright-browsers.sh

RUN chmod +x /app/scripts/ensure-playwright-browsers.sh \
    && mkdir -p /app/data

WORKDIR /app/apps/worker
CMD ["bash", "./entrypoint.sh"]
