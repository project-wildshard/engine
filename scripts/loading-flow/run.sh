#!/usr/bin/env bash
# DL23 (E529, G1006, G1008): the loading flow recording on the iPhone Simulator, for each shard named: cold then warm on
# the default level download (Shardfile, the default set's loose files, which stay in the deploy; a file past that set
# reads through its part, DL20), then the same pair on Runtime packs (DL16's gate; --no-packs skips it). Each
# run plays 30 s after control: 10 s on foot with a slow look, then the hoverboard at boost.
# Run after every boot / download / loading landing and each deploy; a row touching loading closes on a passing run.
#   scripts/loading-flow/run.sh [--base <url>] [--out <dir>] [--no-packs | --packs-only] [--upgrade] [--device-save <key>=<value>]... [--profile] <shard regex>...
#   e.g. run.sh driftwood pine nine; a Debug row's A / B: run.sh --no-packs --device-save debug.earlyPrograms=on nine
# --upgrade: one visit per shard and download with Safari's data kept, run once right after a deploy so it meets the
# previous build's worker and caches (the last run.sh before the deploy left them); no cold or warm run.
# The old worker serves the old page on that visit, which installs the new one: analyse.mjs fails it on ranServedBuild. The
# next --upgrade at that origin is the new code's first load over the held caches, the reading that counts, so one visit
# per origin: a second download or shard at the same origin is already past the swap.
# Default base: live. Each run: <out>/<shard>/<shardfile|packs>/{cold,warm}-timeline.jsonl, -raw.mp4, timeline.json (the
# bar's verdicts, seconds after the tap) and board.jpg (labelled, iPhone portrait). Keep boards in art/download/dl23-flow/.
set -euo pipefail
cd "$(dirname "$0")/../.."
base=https://wildshard-singleplayer.vercel.app
out="tmp/loading-flow/$(date +%Y%m%d-%H%M)"
downloads=(shardfile packs)
modes='cold warm'
shards=()
saves=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --base) base="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --no-packs) downloads=(shardfile); shift ;;
    --packs-only) downloads=(packs); shift ;;
    --upgrade) modes='upgrade'; shift ;;
    --device-save) saves="$saves --device-save '$2'"; shift 2 ;;
    --profile) saves="$saves --profile"; shift ;;
    *) shards+=("$1"); shift ;;
  esac
done
[ "${#shards[@]}" -gt 0 ] || { echo 'usage: run.sh [--base <url>] [--out <dir>] [--no-packs] [--upgrade] <shard regex>...' >&2; exit 2; }
status=0
for shard in "${shards[@]}"; do
  for download in "${downloads[@]}"; do
    dir="$out/$(printf '%s' "$shard" | tr -c 'a-zA-Z0-9-' '-')/$download"
    flag="$saves"; [ "$download" = packs ] && flag="$flag --packs"
    mkdir -p "$dir"
    drives=''
    for mode in $modes; do drives="${drives:+$drives && }node scripts/loading-flow/drive.mjs $mode --shard '$shard' --base '$base' --out '$dir' $flag"; done
    scripts/sim-lane.sh run --max 15 wildshard-loading bash -c "$drives" \
      || { echo "run.sh: $shard ($download) recording failed" >&2; status=1; continue; }
    node scripts/loading-flow/analyse.mjs "$dir" || status=1
    python3 -I scripts/loading-flow/board.py "$dir" || status=1
  done
done
exit "$status"
