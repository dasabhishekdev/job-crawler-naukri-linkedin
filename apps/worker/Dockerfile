FROM mcr.microsoft.com/playwright:v1.61.1-jammy

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Kolkata
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

RUN apt-get update && apt-get install -y -qq tzdata build-essential python3 \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
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
