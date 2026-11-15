#!/usr/bin/env bash
# Runs only on the GitHub Actions runner: rsyncs the reviewed tree and runs deploy/deploy.sh on the VPS.
# Same pattern as ICDS — images are built on the server, not pulled from GHCR.
set -euo pipefail
: "${PROD_SSH_HOST:?Set repository secret PROD_SSH_HOST}"
: "${PROD_SSH_PRIVATE_KEY:?Set repository secret PROD_SSH_PRIVATE_KEY}"
: "${PROD_SSH_KNOWN_HOSTS:?Set repository variable PROD_SSH_KNOWN_HOSTS}"
REMOTE_USER="${PROD_SSH_USER:-deploy}"
SSH_PORT="${PROD_SSH_PORT:-22}"
[[ "$REMOTE_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || { echo 'Invalid PROD_SSH_USER' >&2; exit 1; }
[[ "$PROD_SSH_HOST" =~ ^[a-zA-Z0-9.-]+$ ]] || { echo 'Invalid PROD_SSH_HOST' >&2; exit 1; }
[[ "$SSH_PORT" =~ ^[0-9]+$ ]] || { echo 'Invalid PROD_SSH_PORT' >&2; exit 1; }
GIT_SHA="${GITHUB_SHA:0:12}"
[[ "$GIT_SHA" =~ ^[0-9a-f]+$ ]] || { echo 'Missing GITHUB_SHA' >&2; exit 1; }

umask 077
WORK_DIR="$(mktemp -d)"
cleanup() {
  if [[ -n "${SSH_AGENT_PID:-}" ]]; then ssh-agent -k >/dev/null 2>&1 || true; fi
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT

export KEY_FILE="$WORK_DIR/key" KNOWN_HOSTS_FILE="$WORK_DIR/known_hosts"
python3 - <<'PY'
import os
from pathlib import Path
key = os.environ['PROD_SSH_PRIVATE_KEY'].replace('\r\n', '\n').replace('\r', '\n')
if '\\n' in key and 'BEGIN ' in key and '\n-----' not in key:
    key = key.replace('\\n', '\n')
Path(os.environ['KEY_FILE']).write_text(key.rstrip('\n') + '\n')
Path(os.environ['KNOWN_HOSTS_FILE']).write_text(os.environ['PROD_SSH_KNOWN_HOSTS'].rstrip('\n') + '\n')
PY

cat > "$WORK_DIR/askpass" <<'ASKPASS'
#!/usr/bin/env python3
import os
print(os.environ.get('PROD_SSH_PASSPHRASE', ''))
ASKPASS
chmod 700 "$WORK_DIR/askpass"
export SSH_ASKPASS="$WORK_DIR/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=job-crawler-ci
eval "$(ssh-agent -s)" >/dev/null
ssh-add "$KEY_FILE" </dev/null

SSH_ARGS=(ssh -p "$SSH_PORT" -o IdentitiesOnly=yes -i "$KEY_FILE" -o BatchMode=yes
  -o PreferredAuthentications=publickey -o PasswordAuthentication=no
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KNOWN_HOSTS_FILE"
  -o ConnectTimeout=15 -o ServerAliveInterval=30)

# Deliberately not PROD_APP_DIR: rsync --delete must never inherit another app's path.
REMOTE_DIR="${JOB_CRAWLER_APP_DIR:-}"
if [[ -z "$REMOTE_DIR" ]]; then
  REMOTE_DIR="$("${SSH_ARGS[@]}" "$REMOTE_USER@$PROD_SSH_HOST" 'printf "%s/job-crawler" "$HOME"')"
fi
[[ "$REMOTE_DIR" =~ ^/[a-zA-Z0-9_./-]+$ && "$REMOTE_DIR" != / && "$REMOTE_DIR" != *..* ]] || {
  echo 'JOB_CRAWLER_APP_DIR must be an absolute application path.' >&2; exit 1;
}
echo "Deploy target: $REMOTE_USER@$PROD_SSH_HOST:$REMOTE_DIR ($GIT_SHA)"

"${SSH_ARGS[@]}" "$REMOTE_USER@$PROD_SSH_HOST" "mkdir -p -- '$REMOTE_DIR'"
printf -v RSYNC_SSH '%q ' "${SSH_ARGS[@]}"
# VPS-only .env (secrets) and backups/ survive --delete.
rsync -az --delete \
  --exclude '.git/' --exclude '.github/' --exclude 'node_modules/' --exclude '**/dist/' \
  --exclude 'data/' --exclude 'linkedin-cli/' --exclude 'docs/' --exclude '.playwright-mcp/' \
  --exclude '/.env' --exclude '/.env.prod' --exclude '/backups/' \
  -e "$RSYNC_SSH" ./ "$REMOTE_USER@$PROD_SSH_HOST:$REMOTE_DIR/"
"${SSH_ARGS[@]}" "$REMOTE_USER@$PROD_SSH_HOST" "cd '$REMOTE_DIR' && GIT_SHA='$GIT_SHA' bash deploy/deploy.sh"
