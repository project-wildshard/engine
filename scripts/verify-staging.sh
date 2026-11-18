#!/usr/bin/env bash
# Meta MINI-AUTONOMY MA4: the staging proofs for one browser, as .github/workflows/verify-staging.yml runs them, with one
# pass/fail line per proof in the run summary. Read-only against the live staging page (J205): no secret, no write.
#   bash scripts/verify-staging.sh chromium|webkit [<build>] [<cards, comma separated>]
#     [--root=<dir>] [--out=<dir>] [--url=<origin>] [--native=<file>] [--save-epoch=<n>]
# <build> defaults to what staging.wildshard.io serves now; <cards> to Driftwood and Pine Hollow, the two production go-live
# reads (SB3: page-release.mjs refuses go-live until both pass cold and warm in both browsers on the build). The proofs: J386's tapped journey (journey-proof.mjs) per
# card, cold then warm; every Zone select card and cold chunk link (zone-sweep.mjs); Doctor (e7-doctor-proof.mjs);
# the live two-player proof (e7-live-staging-proof.mjs). Off the
# tailnet (a hosted runner) set WS_PRIVATE_HEALTH=skip; the box's own build and serial are then left to live-status.
# Exit 0 when every proof passed. Output in tmp/verify-staging/<browser>.
set -uo pipefail
browser=${1:-}
[ "$browser" = chromium ] || [ "$browser" = webkit ] || { echo "usage: verify-staging.sh chromium|webkit [<build>] [<cards>]" >&2; exit 2; }
shift
build= cards=driftwood-isle,pine-hollow
if [[ ${1:-} != --* && $# -gt 0 ]]; then build=$1; shift; fi
if [[ ${1:-} != --* && $# -gt 0 ]]; then cards=${1:-$cards}; shift; fi
base=https://staging.wildshard.io
root="$(dirname "$0")/.."
out=tmp/verify-staging/$browser
native=scripts/e7-live-staging-proof.mjs
epoch=()
for arg in "$@"; do
  case "$arg" in
    --root=*) root=${arg#*=} ;;
    --out=*) out=${arg#*=} ;;
    --url=*) base=${arg#*=} ;;
    --native=*) native=${arg#*=} ;;
    --save-epoch=*) epoch+=("$arg") ;;
    *) echo "unknown verify-staging option: $arg" >&2; exit 2 ;;
  esac
done
cd "$root" || exit 2
base=${base%/}
mkdir -p "$out" || exit 1
# A launch failure may produce no report. A previous pass must not survive it.
rm -f "$out/zone-sweep/results.json" "$out/zone-sweep-chunk/results.json" || exit 1
summary=${GITHUB_STEP_SUMMARY:-$out/summary.md}
if [ -z "$build" ]; then
  build=$(curl -fsS --max-time 30 "$base/version.json" | node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(0,"utf8")).build)')
fi
key=$(node -e 'import("./scripts/page-release/flow.mjs").then(m=>process.stdout.write(m.RELEASE_PUBLIC_KEY))')
failed=0
rows=()
printf '' > "$out/proofs.tsv" || exit 1
# One proof: its output to <out>/<name>.log and the console, one row for the summary.
proof() {
  local name=$1; shift
  local log="$out/$name.log" started=$SECONDS
  echo "::group::$name"
  "$@" 2>&1 | tee "$log"
  local status=${PIPESTATUS[0]}
  echo "::endgroup::"
  local verdict=PASS
  if [ "$status" -ne 0 ]; then verdict=FAIL; failed=1; fi
  local why
  why=$(grep -E '^(PASS|FAIL|SKIP)|AssertionError|Error:|  - ' "$log" | grep -v '^PASS' | head -3 | tr '|' '/' | tr '\n' ' ' | cut -c1-300)
  printf '%s\t%s\t%s\n' "$name" "$verdict" "$((SECONDS - started))" >> "$out/proofs.tsv" || failed=1
  rows+=("| $name | $verdict | $((SECONDS - started)) s | ${why:-} |")
}
for card in ${cards//,/ }; do
  proof "journey-$card" node scripts/journey-proof.mjs --url "$base" --card "$card" --browsers "$browser" --out "$out/journey-$card"
done
# meta QA-FEEDBACK-2026-11-17 row 21: every card Zone select shows opens (production go-live reads its results.json)
proof zone-sweep node scripts/zone-sweep.mjs --url "$base" --browser "$browser" --out "$out/zone-sweep"
proof zone-sweep-chunk node scripts/zone-sweep.mjs --url "$base" --browser "$browser" --chunk --out "$out/zone-sweep-chunk"
proof doctor node scripts/e7-doctor-proof.mjs "$base" "$build" "$key" "--engine=$browser"
proof live node "$native" "$base" "$build" "$key" "$browser" ${epoch[@]+"${epoch[@]}"}
{
  echo "## verify-staging: $browser on $base, build \`${build:0:8}\`"
  echo
  echo '```'
  node scripts/live-status.mjs "$build" 2>&1
  echo '```'
  echo
  echo "| Proof | Verdict | Time | Notes |"
  echo "|---|---|---|---|"
  printf '%s\n' "${rows[@]}"
  grep -hE '^(PASS|FAIL) ' "$out"/journey-*.log 2>/dev/null | sed 's/^/    /'
} >> "$summary"
echo "verify-staging: $browser $([ "$failed" = 0 ] && echo PASS || echo FAIL); summary in $summary"
exit "$failed"
