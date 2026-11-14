#!/usr/bin/env bash
# Runs on the GitHub Actions runner: uploads the release files to the VPS over SSH (host key pinned
# by PROD_SSH_KNOWN_HOSTS) and runs deploy/remote-deploy.sh there.
set -euo pipefail
: "${PROD_SSH_HOST:?Set repository secret PROD_SSH_HOST}"
: "${PROD_SSH_PRIVATE_KEY:?Set repository secret PROD_SSH_PRIVATE_KEY}"
: "${PROD_SSH_KNOWN_HOSTS:?Set repository variable PROD_SSH_KNOWN_HOSTS}"
: "${IMAGE_PREFIX:?}" "${IMAGE_TAG:?}" "${PUBLIC_URL:?}" "${REGISTRY_USER:?}" "${REGISTRY_TOKEN:?}"
REMOTE_USER="${PROD_SSH_USER:-deploy}"
SSH_PORT="${PROD_SSH_PORT:-22}"
[[ "$REMOTE_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || { echo "Invalid PROD_SSH_USER" >&2; exit 1; }
[[ "$PROD_SSH_HOST" =~ ^[a-zA-Z0-9.-]+$ ]] || { echo "Invalid PROD_SSH_HOST" >&2; exit 1; }
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] || { echo "Invalid PROD_SSH_PORT" >&2; exit 1; }
[[ "${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}" =~ ^[0-9]+-[0-9]+$ ]] || exit 1

umask 077
WORK_DIR="$(mktemp -d)"
cleanup() {
  if [[ -n "${SSH_AGENT_PID:-}" ]]; then ssh-agent -k >/dev/null 2>&1 || true; fi
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT

key="${PROD_SSH_PRIVATE_KEY//$'\r'/}"
if [[ "$key" == *'\n'* && "$key" != *$'\n-----'* ]]; then key="${key//\\n/$'\n'}"; fi
printf '%s\n' "$key" >"$WORK_DIR/key"
printf '%s\n' "$PROD_SSH_KNOWN_HOSTS" >"$WORK_DIR/known_hosts"
cat >"$WORK_DIR/askpass" <<'ASKPASS'
#!/usr/bin/env bash
printf '%s\n' "${PROD_SSH_PASSPHRASE:-}"
ASKPASS
chmod 700 "$WORK_DIR/askpass"
export SSH_ASKPASS="$WORK_DIR/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=job-crawler-ci
eval "$(ssh-agent -s)" >/dev/null
ssh-add "$WORK_DIR/key" </dev/null >/dev/null

SSH_OPTS=(-o IdentitiesOnly=yes -i "$WORK_DIR/key" -o BatchMode=yes -o PreferredAuthentications=publickey
  -o PasswordAuthentication=no -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$WORK_DIR/known_hosts"
  -o ConnectTimeout=15 -o ServerAliveInterval=30)
TARGET="$REMOTE_USER@$PROD_SSH_HOST"

APP_DIR="${DEPLOY_DIR:-}"
if [[ -z "$APP_DIR" ]]; then
  APP_DIR="$(ssh -p "$SSH_PORT" "${SSH_OPTS[@]}" "$TARGET" 'printf "%s/job-crawler" "$HOME"')"
fi
[[ "$APP_DIR" =~ ^/[a-zA-Z0-9_./-]+$ && "$APP_DIR" != / && "$APP_DIR" != *..* ]] || {
  echo "DEPLOY_DIR must be an absolute path" >&2; exit 1;
}

RELEASE="$WORK_DIR/release"
mkdir "$RELEASE"
cp docker-compose.prod.yml deploy/backup.sh deploy/remote-deploy.sh "$RELEASE/"
{
  for name in IMAGE_PREFIX IMAGE_TAG PUBLIC_URL REGISTRY_USER REGISTRY_TOKEN ADMIN_EMAILS GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
    printf '%s=%q\n' "$name" "${!name:-}"
  done
} >"$RELEASE/release.env"

REMOTE_RELEASE="$APP_DIR/.releases/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
ssh -p "$SSH_PORT" "${SSH_OPTS[@]}" "$TARGET" "mkdir -p -m 700 '$REMOTE_RELEASE'"
scp -P "$SSH_PORT" "${SSH_OPTS[@]}" -q "$RELEASE"/* "$TARGET:$REMOTE_RELEASE/"
ssh -p "$SSH_PORT" "${SSH_OPTS[@]}" "$TARGET" "bash '$REMOTE_RELEASE/remote-deploy.sh' '$REMOTE_RELEASE' '$APP_DIR'"
