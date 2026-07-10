FROM mcr.microsoft.com/playwright:v1.61.1-jammy

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Asia/Kolkata
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

RUN apt-get update && apt-get install -y -qq tzdata build-essential python3 \
    xvfb x11vnc novnc websockify fluxbox x11-utils curl \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY apps/auth-browser/package.json ./apps/auth-browser/

RUN npm install --workspace=@jobportal/auth-browser --include-workspace-root

COPY packages ./packages
COPY apps/auth-browser ./apps/auth-browser
COPY apps/worker/src ./apps/worker/src
COPY config ./config
COPY scripts/ensure-playwright-browsers.sh /app/scripts/ensure-playwright-browsers.sh

RUN chmod +x /app/apps/auth-browser/entrypoint.sh /app/scripts/ensure-playwright-browsers.sh \
    && mkdir -p /app/jobhunter /app/data

WORKDIR /app/apps/auth-browser
EXPOSE 5000 6080

CMD ["bash", "./entrypoint.sh"]
