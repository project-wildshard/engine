#!/usr/bin/env bash
# Ring 1, what a push must pass, as one command: `bash scripts/ring1.sh [static|tests|products|all]`. ring-1.yml runs each step as
# its own job, so a local run is the same work. Each stage prints its seconds, and a red one doesn't hide the rest. It needs no shard
# repo and no secret.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
red=0

stage() {
  local name=$1 started=$SECONDS verdict=green
  shift
  "$@" || { verdict=RED; red=1; }
  echo "ring1: $name $verdict in $((SECONDS - started))s"
}

static() {
  stage typecheck pnpm typecheck
  stage lint pnpm lint
  stage format pnpm format:check
  stage sides pnpm check:sides
}

tests() {
  stage pins node scripts/pins.ts install --ring 1
  stage inputs pnpm gen:inputs
  WILDSHARD_RING=1 stage tests python3 scripts/heavy-lane.py full-test -- pnpm test
}

products() {
  local update=()
  if [ "${RING_RECORD:-}" = true ]; then update=(--update); fi
  stage pins node scripts/pins.ts install --ring 1
  stage cook node scripts/ring-cook.mjs
  stage step node --experimental-transform-types --no-warnings scripts/ring-step.ts --report tmp/ring-cook/step.json "${update[@]}"
  stage build pnpm build:ring
  # Title to play on all three. The grid case isn't here: on three products it stalls at `home`, so road crossings stay in Ring 2 until row 7.
  WILDSHARD_RING=1 stage boot node scripts/parity/boot-smoke.mjs --case-group=developer
}

case "${1:-all}" in
  static) static ;;
  tests) tests ;;
  products) products ;;
  all)
    static
    tests
    products
    ;;
  *)
    echo 'usage: ring1.sh [static|tests|products|all]' >&2
    exit 2
    ;;
esac
exit "$red"
