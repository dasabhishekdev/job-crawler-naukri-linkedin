#!/bin/bash
set -e

bash /app/scripts/ensure-playwright-browsers.sh

export DISPLAY=:99

echo "Starting Xvfb..."
Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX +render -noreset &
for i in $(seq 1 40); do
  if xdpyinfo -display :99 >/dev/null 2>&1; then
    echo "Xvfb ready"
    break
  fi
  sleep 0.25
done

if ! xdpyinfo -display :99 >/dev/null 2>&1; then
  echo "ERROR: Xvfb failed to start"
  exit 1
fi

fluxbox -display :99 &
sleep 0.5

echo "Starting VNC..."
x11vnc -display :99 -nopw -listen 0.0.0.0 -xkb -forever -shared -rfbport 5900 -bg -o /tmp/x11vnc.log
websockify --web=/usr/share/novnc 6080 localhost:5900 &
sleep 1

echo "noVNC ready on http://0.0.0.0:6080"
echo "Auth API starting on port ${AUTH_BROWSER_PORT:-5000}"
exec node src/index.js
