#!/bin/bash
# Install Playwright browsers into PLAYWRIGHT_BROWSERS_PATH only when the volume is empty.
set -e

PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"
export PLAYWRIGHT_BROWSERS_PATH

if ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux/chrome 1>/dev/null 2>&1; then
  echo "Playwright browsers found at $PLAYWRIGHT_BROWSERS_PATH — skipping download."
  exit 0
fi

echo "Playwright browsers not found at $PLAYWRIGHT_BROWSERS_PATH — installing once..."
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 npx playwright install chromium
echo "Playwright browsers installed."
