#!/usr/bin/env bash
# E7.8b: the timed restore. It puts the newest dump in a scratch database, prints the seconds it took and the row counts, and drops the
# scratch database. As root it works as `postgres`.
#   sudo restore-check.sh [<dump file>]
set -euo pipefail

DIR=${DUMP_DIR:-/var/lib/wildshard/dumps} DATABASE=${DUMP_DATABASE:-saves_production} SCRATCH=saves_restore_check
as_postgres() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

DUMP=${1:-$(find "$DIR" -name "$DATABASE-*.dump" | sort | tail -1)}
if [ -z "$DUMP" ]; then echo 'restore: no dump found'; exit 1; fi
STARTED=$(date +%s)
as_postgres dropdb --if-exists "$SCRATCH"
trap 'as_postgres dropdb --if-exists "$SCRATCH"' EXIT
as_postgres createdb "$SCRATCH"
as_postgres pg_restore --no-owner --exit-on-error --dbname="$SCRATCH" < "$DUMP"
TOOK=$(($(date +%s) - STARTED))

COUNTS="select (select count(*) from player), (select count(*) from player_save), (select count(*) from ledger_receipt), (select count(*) from chat_report)"
RESTORED=$(as_postgres psql -qtAc "$COUNTS" "$SCRATCH")
echo "restore: $(basename "$DUMP") in $TOOK s. player|player_save|ledger_receipt|chat_report: $RESTORED"
