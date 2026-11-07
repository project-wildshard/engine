#!/usr/bin/env bash
# iphone-mem-reading.sh — the USB iPhone's Nalati memory + fps reading in one go (NALATI-FINISH B8 + P4 / N11, E302), the
# E263 method: paired USB Web Inspector, Memory.trackingUpdate (~500 ms) summed, decimal GB.
#
# Before: the iPhone on USB, unlocked, trusted; Safari ▸ Settings ▸ Advanced ▸ Web Inspector ON; one Safari tab open on
# https://wildshard-singleplayer.vercel.app/version.json in front (the script drives that tab); Low Power Mode OFF
# (Settings ▸ Battery) for the fps reading; pause ▸ Settings ▸ graphics at max if the build has such a pick.
#
#   scripts/iphone-mem-reading.sh [--base https://wildshard-singleplayer.vercel.app] [--fps 150]
#
# Runs, each written to progress/b8/phone-<run>-<time>.jsonl and summarised on stdout:
#   1. pine→nalati (href)     the E263 flow exactly: Pine Hollow loaded, then Nalati by an assigned navigation
#   2. pine→nalati (replace)  the same through the game's own shard switch (src/game/travel/switch.ts: location.replace, B8)
#   3. nalati fps             Nalati re-loaded, the world entered, renderer frames / wall time per 10 s for --fps seconds
#                             (the thermal fall-off after 1–2 min shows in the later windows)
set -euo pipefail
cd "$(dirname "$0")/.."
BASE=https://wildshard-singleplayer.vercel.app
FPS=150
while [ $# -gt 0 ]; do case "$1" in --base) BASE=$2; shift 2;; --fps) FPS=$2; shift 2;; *) echo "unknown $1" >&2; exit 2;; esac; done
UDID=$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone 17/ && $0 !~ /unavailable/ {print "ok"}' | head -1)
[ "$UDID" = ok ] || { echo "Jake's iPhone is not connected / available (xcrun devicectl list devices)"; exit 1; }
PORT=9231
if ! curl -fsS "http://127.0.0.1:$PORT/json/list" >/dev/null 2>&1; then
  uvx --from pymobiledevice3 pymobiledevice3 webinspector cdp --host 127.0.0.1 --port $PORT > progress/b8/phone-cdp.log 2>&1 &
  BRIDGE=$!
  trap 'kill $BRIDGE 2>/dev/null || true' EXIT
  for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$PORT/json/list" >/dev/null 2>&1 && break; sleep 1; done
fi
page() { curl -fsS "http://127.0.0.1:$PORT/json/list" | python3 -c 'import json,sys; p=[x for x in json.load(sys.stdin) if "wildshard" in x.get("url","")]; print(p[0]["webSocketDebuggerUrl"] if p else "")'; }
WS=$(page); [ -n "$WS" ] || { echo "no Safari tab on the game's origin: open $BASE/version.json on the phone"; exit 1; }
STAMP=$(date +%Y%m%d-%H%M)
echo "== 1. pine→nalati (href) · $WS"
node scripts/webkit-mem-reading.mjs --ws="$WS" --tag="phone-href-$STAMP" --from="$BASE/?chunk=pine-hollow" --url="$BASE/?chunk=nalati-grasslands" --nav=href --no-explore
WS=$(page)
echo "== 2. pine→nalati (replace, the game's switch)"
node scripts/webkit-mem-reading.mjs --ws="$WS" --tag="phone-replace-$STAMP" --from="$BASE/?chunk=pine-hollow" --url="$BASE/?chunk=nalati-grasslands" --nav=replace --no-explore
WS=$(page)
echo "== 3. nalati: Explorer + world + fps ($FPS s)"
node scripts/webkit-mem-reading.mjs --ws="$WS" --tag="phone-fps-$STAMP" --url="$BASE/?chunk=nalati-grasslands" --fps="$FPS"
