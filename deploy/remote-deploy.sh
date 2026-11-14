#!/usr/bin/env bash
# Runs ON THE VPS, invoked by deploy/ship.sh from GitHub Actions:
#   bash <release-dir>/remote-deploy.sh <release-dir> <app-dir>
# <release-dir> holds docker-compose.prod.yml, backup.sh, this script and release.env
# (values managed in GitHub + a short-lived registry token). It is deleted when done.
#
# First deploy: creates <app-dir>/.env and generates SESSION_SECRET, APP_ENCRYPTION_KEY and the
# MongoDB password on the server. Back that file up: losing APP_ENCRYPTION_KEY makes stored
# AI keys unreadable, and the MongoDB password cannot change after the database is created.
set -euo pipefail

RELEASE_DIR="${1:?release dir}"
APP_DIR="${2:?app dir}"
COMPOSE=(docker compose -f docker-compose.prod.yml)

cleanup() { rm -rf -- "$RELEASE_DIR"; }
trap cleanup EXIT

mkdir -p "$APP_DIR/backups"
cd "$APP_DIR"
exec 9>"$APP_DIR/.deploy.lock"
flock -w 600 9 || { echo "Another deployment is still running" >&2; exit 1; }

# shellcheck disable=SC1091
source "$RELEASE_DIR/release.env"
: "${IMAGE_PREFIX:?}" "${IMAGE_TAG:?}" "${PUBLIC_URL:?}" "${REGISTRY_USER:?}" "${REGISTRY_TOKEN:?}"

docker network inspect web >/dev/null 2>&1 || {
  echo "Docker network 'web' is missing: deploy the hosting edge router (repo hosting) first." >&2
  exit 1
}

env_get() { sed -n "s/^$1=//p" .env | tail -n 1; }
env_set() {
  local key="$1" value="$2"
  [[ "$value" != *[$'\n'\"\'\$\\]* ]] || {
    echo "Refusing unsafe characters in $key" >&2; exit 1;
  }
  if grep -q "^$key=" .env; then
    local tmp
    tmp="$(mktemp .env.XXXXXX)"
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' .env >"$tmp"
    chmod 600 "$tmp"
    mv "$tmp" .env
  else
    printf '%s=%s\n' "$key" "$value" >>.env
  fi
}
ensure_secret() { [[ -n "$(env_get "$1")" ]] || { env_set "$1" "$2"; echo "Generated $1 in $APP_DIR/.env"; }; }

umask 077
touch .env
chmod 600 .env
ensure_secret SESSION_SECRET "$(openssl rand -hex 32)"
ensure_secret APP_ENCRYPTION_KEY "$(openssl rand -base64 32)"
ensure_secret MONGO_ROOT_USER jobcrawler
ensure_secret MONGO_ROOT_PASSWORD "$(openssl rand -hex 24)"
env_set PUBLIC_URL "$PUBLIC_URL"
env_set IMAGE_PREFIX "$IMAGE_PREFIX"
for key in ADMIN_EMAILS GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  [[ -n "${!key:-}" ]] && env_set "$key" "${!key}"
done
umask 022

install -m 644 "$RELEASE_DIR/docker-compose.prod.yml" docker-compose.prod.yml
install -m 755 "$RELEASE_DIR/backup.sh" backup.sh

PREVIOUS_TAG="$(env_get IMAGE_TAG)"
printf '%s' "$REGISTRY_TOKEN" | docker login ghcr.io -u "$REGISTRY_USER" --password-stdin >/dev/null
export IMAGE_TAG
"${COMPOSE[@]}" pull --quiet
docker logout ghcr.io >/dev/null

healthy() {
  local service status
  for service in api browser web; do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q "$service")" 2>/dev/null || true)"
    [[ "$status" == healthy ]] || return 1
  done
}
wait_healthy() {
  for _ in $(seq 1 36); do
    healthy && return 0
    sleep 5
  done
  return 1
}

if "${COMPOSE[@]}" up -d --remove-orphans && wait_healthy; then
  env_set IMAGE_TAG "$IMAGE_TAG"
  echo "Deployed $IMAGE_TAG"
else
  echo "New release $IMAGE_TAG is not healthy:" >&2
  "${COMPOSE[@]}" ps >&2 || true
  "${COMPOSE[@]}" logs --tail 60 api web browser >&2 || true
  if [[ -n "$PREVIOUS_TAG" && "$PREVIOUS_TAG" != "$IMAGE_TAG" ]]; then
    echo "Rolling back to $PREVIOUS_TAG" >&2
    IMAGE_TAG="$PREVIOUS_TAG" "${COMPOSE[@]}" up -d --remove-orphans
  fi
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -qx edge-nginx; then
  if docker exec edge-nginx wget -qO- http://job-crawler-web/api/health >/dev/null; then
    echo "Reachable from edge-nginx as job-crawler-web"
  else
    echo "Warning: edge-nginx cannot reach job-crawler-web yet (check the hosting route)" >&2
  fi
fi

docker image prune -f >/dev/null
