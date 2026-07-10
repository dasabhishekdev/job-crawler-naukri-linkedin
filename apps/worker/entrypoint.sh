#!/bin/bash
set -e

bash /app/scripts/ensure-playwright-browsers.sh
exec npm start
