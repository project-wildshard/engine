#!/usr/bin/env bash
# The caller holds the model lock, capped at 30 minutes for this whole batch.
set -euo pipefail
URL="${1:?url}"; TAG="${2:?tag}"; NODE="${3:?absolute node}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
mkdir -p progress
rc=0
bash scripts/browser-lane.sh --max 10 "$NODE" scripts/nine-dragon-gpu.mjs "--url=$URL" --subtract=none || rc=1
bash scripts/browser-lane.sh --max 10 "$NODE" scripts/pine-hollow-gpu.mjs "--url=$URL" "--tag=$TAG" --subtract=0 --overdraw=0 || rc=1
for ruler in scripts/*-gpu.mjs; do
  [ -f "$ruler" ] || continue
  case "$ruler" in scripts/nine-dragon-gpu.mjs|scripts/pine-hollow-gpu.mjs) continue;; esac
  bash scripts/browser-lane.sh --max 10 "$NODE" "$ruler" "--url=$URL" || rc=1
done
bash scripts/browser-lane.sh --max 10 "$NODE" scripts/scorecard.mjs "--url=$URL" "--tag=nightly-$TAG" --no-switch --compare=baseline || rc=1
exit "$rc"
