#!/usr/bin/env bash
# E7.8b (Q81): the nightly dump, kept 7 days here and in a private bucket, because it holds device ids. With no BACKUP_REMOTE it stays on this disk.
# Any failure tells ALERT_URL, because a backup that stopped is otherwise silent.
# J252: it also checks in to the Sentry Crons monitor `wildshard-dump` (wildshard-server project), on start and on
# finish, so a run that fails or never starts shows red to the agents' hourly read. SENTRY_CRON_DSN is that project's
# DSN, from /etc/wildshard/ops.env; blank skips it. A check-in that fails never fails the dump.
#   DUMP_DIR=... [DUMP_DATABASE=...] [BACKUP_REMOTE=r2:wildshard-backups] [ALERT_URL=...] [SENTRY_CRON_DSN=...] dump.sh
set -euo pipefail

DIR=${DUMP_DIR:-/var/lib/wildshard/dumps} DATABASE=${DUMP_DATABASE:-saves_production} REMOTE=${BACKUP_REMOTE:-} ALERT_URL=${ALERT_URL:-}
KEEP_DAYS=7

# https://<key>@<host>/<project> -> https://<host>/api/<project>/cron/wildshard-dump/<key>/
checkin() {
  local dsn=${SENTRY_CRON_DSN:-} key rest
  if [ -z "$dsn" ]; then return 0; fi
  key=${dsn#*://} key=${key%%@*} rest=${dsn#*@}
  curl -fsS -m 10 -o /dev/null "https://${rest%%/*}/api/${rest##*/}/cron/wildshard-dump/$key/?status=$1" || true
}

umask 077
NAME="$DATABASE-$(date -u +%Y-%m-%dT%H%M%SZ).dump" STARTED=$(date +%s)
failed() {
  echo 'dump: failed'
  rm -f "$DIR/$NAME.part"
  checkin error
  if [ -n "$ALERT_URL" ]; then curl -fsS -m 10 -d "Wildshard's nightly dump failed" "$ALERT_URL" >/dev/null || true; fi
}
trap failed ERR
checkin in_progress

pg_dump --format=custom --file="$DIR/$NAME.part" "$DATABASE"
mv "$DIR/$NAME.part" "$DIR/$NAME"
find "$DIR" -name "$DATABASE-*.dump" -mtime +$((KEEP_DAYS - 1)) -delete
if [ -n "$REMOTE" ]; then
  rclone copyto "$DIR/$NAME" "$REMOTE/$NAME"
  rclone delete --min-age "${KEEP_DAYS}d" "$REMOTE"
else
  echo 'dump: no BACKUP_REMOTE, so this one stays on this disk'
fi
echo "dump: $NAME, $(wc -c < "$DIR/$NAME" | tr -d ' ') bytes, $(($(date +%s) - STARTED)) s"
checkin ok
