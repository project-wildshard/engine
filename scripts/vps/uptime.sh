#!/usr/bin/env bash
# E7.8c (Q82): each minute, is the server answering? A stopped server tells Jake's phone once, and once more when it's back. Two misses in a row
# count, so a deploy's restart stays quiet. A failed send tries again next minute.
#   HEALTH_URL=... UPTIME_STATE=... ALERT_URL=... uptime.sh
set -uo pipefail

HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:8790/health} STATE=${UPTIME_STATE:-/var/lib/wildshard/uptime.state} ALERT_URL=${ALERT_URL:-}
MISSES_TO_ALERT=2

send() {
  echo "uptime: $1"
  if [ -z "$ALERT_URL" ]; then return 0; fi
  curl -fsS -m 10 -d "$1" "$ALERT_URL" >/dev/null
}

misses=0 told=0
if [ -r "$STATE" ]; then read -r misses told < "$STATE" || true; fi
misses=${misses:-0} told=${told:-0}
if curl -fsS -m 5 "$HEALTH_URL" >/dev/null 2>&1; then
  misses=0
  if [ "$told" = 1 ] && send 'Wildshard is back up'; then told=0; fi
else
  misses=$((misses + 1))
  if [ "$misses" -ge "$MISSES_TO_ALERT" ] && [ "$told" = 0 ] && send "Wildshard is down: no answer from /health for $misses checks"; then told=1; fi
fi
echo "$misses $told" > "$STATE"
