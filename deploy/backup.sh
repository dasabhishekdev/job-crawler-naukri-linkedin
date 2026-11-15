#!/bin/bash
# Nightly MongoDB backup loop (runs inside the "backup" service). Restore with:
#   docker compose -f docker-compose.prod.yml exec -T backup \
#     mongorestore --uri "$MONGO_URI" --gzip --archive=/backups/<file>.archive.gz --drop
set -euo pipefail

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

while true; do
  stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
  file="/backups/jobportal-${stamp}.archive.gz"
  if mongodump --uri "$MONGO_URI" --db jobportal --gzip --archive="$file" --quiet; then
    echo "[backup] wrote $file ($(du -h "$file" | cut -f1))"
  else
    echo "[backup] mongodump failed" >&2
    rm -f "$file"
  fi
  find /backups -name 'jobportal-*.archive.gz' -mtime +"$KEEP_DAYS" -delete
  sleep 86400
done
