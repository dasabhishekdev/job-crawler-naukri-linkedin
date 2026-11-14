# Base image version must match the "playwright" dependency so its bundled Chromium is used.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

ENV NODE_ENV=production TZ=Asia/Kolkata PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
COPY packages/ai/package.json packages/ai/
COPY packages/portals/package.json packages/portals/
COPY apps/browser/package.json apps/browser/
RUN npm ci --workspace=@jobportal/browser --include-workspace-root --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY packages ./packages
COPY apps/browser ./apps/browser

USER pwuser
ENV HOME=/home/pwuser
WORKDIR /app/apps/browser
EXPOSE 5100
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:5100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
