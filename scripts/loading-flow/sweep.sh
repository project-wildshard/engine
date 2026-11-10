#!/usr/bin/env bash
# J136: DOWNLOAD closes on one passing sweep on the flip build plus one sitting of phone checks. This is the sweep: every
# reading the open rows name, against one URL, and a verdict per row. About 3 hours on a free Simulator.
#   scripts/loading-flow/sweep.sh <url> [--out <dir under ./tmp>] [--dist <served build's dist>] [--worker-row] [--only <step,step>]
# Steps, in order, each skipped when <out>/.done/<step> exists, so a rerun resumes:
#   gate      DL15, DL17, DL1, DL25: the complete-at-control gate on the six shards and the grid, packs on, cold, plus Driftwood's
#             re-entry during the precache. The grid needs the build's source maps: without --dist the sweep serves
#             the same commit locally and gates the grid there.
#   flow      DL23, DL21, DL24, DL18: the Simulator recording of the three shards DL5's pairs leave out, packs on, cold and warm
#   pairs     DL5, DL23: n=3 of Driftwood, Nine and Pine, Shardfile and packs, cold and warm
#   title     DL2: the phone link, grid, cold, title dwell 3 s against 0 s
#   tasks     DL11, DL24: Nine on the phone link with 30 s of play: the long-task count and the first second
#   programs  DL10: bake-entry-programs --check on each shard
#   digest    DL20: yesterday's telemetry digest (live only)
# --worker-row: before the flip, run the same gate and flows on J130's Developer row, so a preview can prove the worker path.
# Machine: browsers through scripts/browser-lane.sh, the Simulator through scripts/sim-lane.sh; if the upgrade watcher holds
# the Simulator, a flow step fails and the rerun picks it up. The upgrade visit is not here: it is one visit, right after a deploy.
set -uo pipefail
cd "$(dirname "$0")/../.."
url=''; out=''; dist=''; only=''; worker=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --dist) dist="$2"; shift 2 ;;
    --only) only=",$2,"; shift 2 ;;
    --worker-row) worker=1; shift ;;
    -*) echo "sweep.sh: unknown option $1" >&2; exit 2 ;;
    *) url="${1%/}"; shift ;;
  esac
done
[ -n "$url" ] || { echo 'usage: sweep.sh <url> [--out <dir>] [--dist <dir>] [--worker-row] [--only <step,step>]' >&2; exit 2; }
build=$(curl -fsS --max-time 15 "$url/version.json" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["build"])') \
  || { echo "sweep.sh: no version.json at $url" >&2; exit 2; }
rev=${build%%-*}
[ -n "$out" ] || out="tmp/download-sweep/$build"
node scripts/loading-flow/sweep-input.mjs "$out" "$url" "$build" "$worker" || exit 2
mkdir -p "$out/.done" "$out/gate"
echo "sweep: $build at $url, into $out"

SHARDS='driftwood-isle far-reach nalati-grasslands nine-dragon-stack pine-hollow sunscar-dunes'
row=(); flows=()
[ "$worker" = 1 ] && { row=(--device-save=debug.workerClient=on); flows=(--device-save debug.workerClient=on); }
wanted() { [ -z "$only" ] || [[ "$only" == *",$1,"* ]]; }
step() { # step <name> <cmd...>: a failure leaves no mark, so the next run tries it again
  local name=$1; shift
  [ -e "$out/.done/$name" ] && { echo "sweep: $name already read"; return 0; }
  echo "sweep: $name"
  if "$@"; then touch "$out/.done/$name"; else echo "sweep: $name did not finish (exit $?)" >&2; fi
}
gate() { # gate <flow> <base> [flags]: exit 1 is a red reading, still a reading; only 2 means none
  local flow=$1 base=$2; shift 2
  scripts/browser-lane.sh --max 20 node scripts/complete-at-control.mjs --base="$base" --rev="$rev" --flow="$flow" --level-download=packs \
    ${row[@]+"${row[@]}"} "$@" --out="$PWD/$out/gate/$flow${tag:-}.json"
  [ "$?" -lt 2 ]
}
gridGate() {
  local base=$url from=$dist
  if [ -z "$from" ]; then
    case "$url" in
      *127.0.0.1*|*localhost*) from=$(awk '{print $3}' "$HOME/.dev-servers/${url##*:}" 2>/dev/null)/dist ;;
      *) base=$(scripts/serve-build.sh --rev "$rev" --name download-sweep --hours 6 | tail -1); base=${base%/}
         from=$(awk '{print $3}' "$HOME/.dev-servers/${base##*:}")/dist ;;
    esac
  fi
  gate grid "$base" --trace=on --dist="$from"
}
if wanted gate; then
  for flow in $SHARDS; do step "gate-$flow" gate "$flow" "$url"; done
  step gate-grid gridGate
  tag=-reentry step gate-driftwood-reentry gate driftwood-isle "$url" --warm=on --link=phone
fi
if wanted flow; then
  for shard in nalati reach dunes; do
    step "flow-$shard" scripts/loading-flow/run.sh --base "$url" --out "$out/flow" --packs-only ${flows[@]+"${flows[@]}"} "$shard"
  done
fi
if wanted pairs; then
  for n in 1 2 3; do for shard in driftwood nine pine; do
    step "pair-$n-$shard" scripts/loading-flow/run.sh --base "$url" --out "$out/pairs/$n" ${flows[@]+"${flows[@]}"} "$shard"
  done; done
fi
phone() { # phone <log> <args>: the phone link's run, its log kept; exit 1 is a run with an error, still read by the report
  local log=$1; shift
  scripts/browser-lane.sh --max 30 node --experimental-transform-types scripts/phone-loading/main.ts --url "$url/" "$@" 2>&1 | tee "$out/$log.log" | tail -3 | cut -c1-200
  grep -q '^JSON ' "$out/$log.log"
}
if wanted title; then
  step title-3000 phone title-3000 --flow grid --title-dwell 3000
  step title-0 phone title-0 --flow grid --title-dwell 0
fi
wanted tasks && step tasks phone tasks --flow select:nine-dragon-stack --play 30
programs() { scripts/browser-lane.sh --max 30 node scripts/bake-entry-programs.mjs --base "$url" --check $SHARDS 2>&1 | tee "$out/programs.log" | tail -7 | cut -c1-200; }
wanted programs && step programs programs
digest() { node scripts/telemetry-brief.mjs 2>&1 | tee "$out/digest.log" | cut -c1-200; }
wanted digest && step digest digest
exec node scripts/loading-flow/sweep-report.mjs "$out"
