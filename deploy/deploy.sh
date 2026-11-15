#!/usr/bin/env bash
# Production deploy — runs on the VPS (manually or from GitHub Actions).
# Builds images locally, swaps containers, verifies health, rolls back on failure.
# Same pattern as ICDS: no GHCR pull; MongoDB data stays in the named volume.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f docker-compose.prod.yml)
IMAGES=(job-crawler-web job-crawler-api job-crawler-worker job-crawler-browser)
HEALTHY_CONTAINERS=(job-crawler-web job-crawler-api job-crawler-browser job-crawler-mongodb)
MONGO_VOLUME=job-crawler_mongo_data
export GIT_SHA="${GIT_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo manual)}"

if ! docker network inspect web >/dev/null 2>&1; then
  echo "Docker network 'web' is missing — start the hosting router first (cd ~/hosting && docker compose up -d)." >&2
  exit 1
fi

env_get() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1; }
env_set() {
  local key="$1" value="$2"
  [[ "$value" != *[$'\n'\"\'\$\\]* ]] || {
    echo "Refusing unsafe characters in $key" >&2; exit 1;
  }
  if [[ -f .env ]] && grep -q "^$key=" .env; then
    local tmp
    tmp="$(mktemp .env.XXXXXX)"
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' .env >"$tmp"
    chmod 600 "$tmp"
    mv "$tmp" .env
  else
    printf '%s=%s\n' "$key" "$value" >>.env
  fi
}
ensure_secret() { [[ -n "$(env_get "$1")" ]] || { env_set "$1" "$2"; echo "Generated $1 in $ROOT/.env"; }; }

# APP_ENCRYPTION_KEY must decode to exactly 32 bytes (aes-256-gcm). Placeholder
# values in .env.prod used to slip through ensure_secret and break AI key saves.
encryption_key_ok() {
  local raw="$1"
  [[ -n "$raw" ]] || return 1
  node -e '
    const raw = process.argv[1] || "";
    let key;
    try {
      key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    } catch {
      process.exit(1);
    }
    process.exit(key.length === 32 ? 0 : 1);
  ' "$raw"
}

umask 077
if [[ ! -f .env ]]; then
  echo "==> Creating .env from .env.example (secrets stay on this server only)"
  cp .env.example .env
  chmod 600 .env
fi
ensure_secret SESSION_SECRET "$(openssl rand -hex 32)"
ensure_secret APP_ENCRYPTION_KEY "$(openssl rand -base64 32)"
if ! encryption_key_ok "$(env_get APP_ENCRYPTION_KEY)"; then
  echo "==> APP_ENCRYPTION_KEY is invalid (not 32 bytes) — regenerating. Re-enter any saved AI keys after deploy."
  env_set APP_ENCRYPTION_KEY "$(openssl rand -base64 32)"
fi
ensure_secret MONGO_ROOT_USER jobcrawler
ensure_secret MONGO_ROOT_PASSWORD "$(openssl rand -hex 24)"
# Production public URL — keep any value already set in .env.
if [[ -z "$(env_get PUBLIC_URL)" || "$(env_get PUBLIC_URL)" == "http://localhost:3006" ]]; then
  env_set PUBLIC_URL "${PUBLIC_URL:-https://job-crawler.educoreva.com}"
fi
umask 022

wait_container_healthy() {
  local name="$1" tries="${2:-45}" status
  for _ in $(seq 1 "$tries"); do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null || echo missing)"
    [[ "$status" == healthy ]] && return 0
    sleep 2
  done
  echo "Container $name did not become healthy (last status: $status)." >&2
  return 1
}

wait_healthy() {
  local name
  for name in "${HEALTHY_CONTAINERS[@]}"; do
    wait_container_healthy "$name" 60 || return 1
  done
}

smoke_test() {
  local curl=(docker run --rm --network web curlimages/curl:8.10.1 -fsS)
  "${curl[@]}" http://job-crawler-web/api/health >/dev/null
}

mongo_auth_ok() {
  local user pass
  user="$(env_get MONGO_ROOT_USER)"
  pass="$(env_get MONGO_ROOT_PASSWORD)"
  "${COMPOSE[@]}" exec -T mongodb mongosh --quiet \
    --username "$user" --password "$pass" --authenticationDatabase admin \
    --eval 'db.adminCommand({ ping: 1 }).ok' 2>/dev/null | grep -qx '1'
}

# MONGO_INITDB_* only applies on an empty data dir. If .env was regenerated while the
# volume kept the old password, apps fail with SCRAM storedKey mismatch — reset once.
ensure_mongo_credentials() {
  echo "==> Starting MongoDB"
  "${COMPOSE[@]}" up -d mongodb
  wait_container_healthy job-crawler-mongodb 45

  if mongo_auth_ok; then
    echo "MongoDB credentials match .env"
    return 0
  fi

  echo "==> MongoDB auth failed for user '$(env_get MONGO_ROOT_USER)' — .env password does not match volume."
  echo "    Resetting volume $MONGO_VOLUME so MONGO_INITDB_* from .env can initialize a fresh database."
  "${COMPOSE[@]}" stop mongodb >/dev/null
  "${COMPOSE[@]}" rm -f mongodb >/dev/null
  docker volume rm -f "$MONGO_VOLUME" >/dev/null
  "${COMPOSE[@]}" up -d mongodb
  wait_container_healthy job-crawler-mongodb 45
  if ! mongo_auth_ok; then
    echo "MongoDB still rejects .env credentials after volume reset." >&2
    "${COMPOSE[@]}" logs --tail 40 mongodb >&2 || true
    return 1
  fi
  echo "MongoDB re-initialized with current .env credentials"
}

had_previous=true
for image in "${IMAGES[@]}"; do
  if docker image inspect "$image:latest" >/dev/null 2>&1; then
    docker tag "$image:latest" "$image:previous"
  else
    had_previous=false
  fi
done

echo "==> Building images ($GIT_SHA)"
"${COMPOSE[@]}" build --pull

ensure_mongo_credentials

echo "==> Starting app containers"
up_ok=true
if ! "${COMPOSE[@]}" up -d --remove-orphans; then
  up_ok=false
  echo "==> docker compose up failed — container logs:" >&2
  "${COMPOSE[@]}" ps -a >&2 || true
  "${COMPOSE[@]}" logs --tail 80 api mongodb browser web worker >&2 || true
fi

echo "==> Verifying"
if [[ "$up_ok" == true ]] && wait_healthy && smoke_test; then
  for image in "${IMAGES[@]}"; do
    docker tag "$image:latest" "$image:$GIT_SHA"
  done
  docker image prune -f >/dev/null
  "${COMPOSE[@]}" ps
  if docker ps --format '{{.Names}}' | grep -qx edge-nginx; then
    if docker exec edge-nginx wget -qO- http://job-crawler-web/api/health >/dev/null; then
      echo "Reachable from edge-nginx as job-crawler-web"
    else
      echo "Warning: edge-nginx cannot reach job-crawler-web yet (check the hosting route)" >&2
    fi
  fi
  echo "Deploy complete: $GIT_SHA"
  exit 0
fi

echo "==> Deploy failed — rolling back" >&2
"${COMPOSE[@]}" ps -a >&2 || true
"${COMPOSE[@]}" logs --tail 80 api mongodb web browser worker >&2 || true
if [[ "$had_previous" == true ]]; then
  for image in "${IMAGES[@]}"; do docker tag "$image:previous" "$image:latest"; done
  "${COMPOSE[@]}" up -d --no-build --force-recreate api web browser worker || true
  wait_healthy && echo "Rolled back to previous images." >&2
fi
exit 1
