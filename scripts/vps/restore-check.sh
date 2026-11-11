#!/usr/bin/env bash
# E7.8b: the timed restore. It puts the newest dump in a scratch database, prints the seconds it took and the row counts, and drops the
# scratch database. As root it works as `postgres` only to make and drop the scratch database; the archive itself is restored, and
# read back, as `wildshard_restore`, a role with no superuser and nothing else, because a crafted archive's SQL runs as whoever
# restores it (MMO-SERVER-PLAN MS3.3: the allowlist lets raynos name the file).
# VH13: an encrypted dump (`.dump.age`) needs AGE_IDENTITY, a file holding the off-box private key; it is decrypted into a
# private temporary file that goes when the check ends.
#   sudo [AGE_IDENTITY=<key file>] restore-check.sh [<dump file> [<key file>]]
set -euo pipefail

DIR=${DUMP_DIR:-/var/lib/wildshard/dumps} DATABASE=${DUMP_DATABASE:-saves_production} SCRATCH=saves_restore_check
as_postgres() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
RESTORER=wildshard_restore

AGE_IDENTITY=${2:-${AGE_IDENTITY:-}}
DUMP=${1:-$(find "$DIR" \( -name "$DATABASE-*.dump" -o -name "$DATABASE-*.dump.age" \) | sort | tail -1)}
if [ -z "$DUMP" ]; then echo 'restore: no dump found'; exit 1; fi
STARTED=$(date +%s) PLAIN=
cleanup() { as_postgres dropdb --if-exists "$SCRATCH"; if [ -n "$PLAIN" ]; then rm -f -- "$PLAIN"; fi; }
trap cleanup EXIT
if [ "${DUMP%.age}" != "$DUMP" ]; then
  if [ -z "${AGE_IDENTITY:-}" ] || [ ! -r "$AGE_IDENTITY" ]; then echo 'restore: an encrypted dump needs AGE_IDENTITY, the off-box key file'; exit 1; fi
  PLAIN=$(umask 077; mktemp)
  age -d -i "$AGE_IDENTITY" -o "$PLAIN" "$DUMP"
  head -c 5 "$PLAIN" | grep -q '^PGDMP' || { echo 'restore: the decrypted file is not a pg_dump archive'; exit 1; }
  DUMP=$PLAIN
fi
as_postgres dropdb --if-exists "$SCRATCH"
as_postgres createdb -O "$RESTORER" "$SCRATCH"
as_postgres pg_restore --no-owner --no-acl --exit-on-error --username="$RESTORER" --dbname="$SCRATCH" < "$DUMP"
TOOK=$(($(date +%s) - STARTED))

COUNTS="select (select count(*) from player), (select count(*) from player_save), (select count(*) from ledger_receipt), (select count(*) from chat_report)"
RESTORED=$(as_postgres psql -qtAc "$COUNTS" --username="$RESTORER" "$SCRATCH")
echo "restore: $(basename "$DUMP") in $TOOK s. player|player_save|ledger_receipt|chat_report: $RESTORED"
