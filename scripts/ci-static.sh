#!/usr/bin/env bash
# CI-JOB-PACKING (J244): ci's static checks as one command, so a packed job runs them as one unit beside its test shards.
#   bash scripts/ci-static.sh code   every check a code push needs (the old `static` job, step for step)
#   bash scripts/ci-static.sh docs   what a docs-only push still runs: lint, format and the committed asks
# Each check prints its seconds; a red one doesn't hide the rest, and any red makes the exit code 1.
# Run it before `pnpm pins`: some proofs install their own few pins, which replaces the published mounts.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
red=0
check() {
  local name=$1 started=$SECONDS
  shift
  echo "::group::static: $name"
  if "$@"; then echo "::endgroup::"; echo "static: $name green in $((SECONDS - started))s"
  else echo "::endgroup::"; echo "::error title=static $name::red after $((SECONDS - started))s"; red=1; fi
}
proof() { local loader=$1; shift; node --import "./scripts/$loader" --experimental-transform-types --test "$@"; }

mode=${1:-code}
case "$mode" in code|docs) ;; *) echo 'usage: ci-static.sh [code|docs]' >&2; exit 2 ;; esac
if [ "$mode" = code ]; then check typecheck pnpm typecheck; fi
check lint pnpm lint
check format pnpm format:check
if [ "$mode" = code ]; then
  check entry-model-values proof bake-loader.mjs test/ci/entry-model-values.proof.mjs
  check quest-home-lifetime proof bake-loader.mjs test/ci/quest-home-lifetime.proof.mjs
  check hover-boost proof bake-loader.mjs test/ci/hover-boost.proof.mjs
  check net-exchange bash -c 'node scripts/pins.ts install driftwood-isle pine-hollow && node --import ./scripts/sim-node-loader.mjs --experimental-transform-types --test test/ci/net-exchange.proof.mjs'
  check native-loadout proof sim-node-loader.mjs test/ci/native-loadout.proof.mjs
  check keyed-sky-clock proof sim-node-loader.mjs test/ci/keyed-sky-clock.proof.mjs
  check interaction-placement proof sim-node-loader.mjs test/ci/interaction-placement.proof.mjs
  check weather bash -c 'node scripts/pins.ts install pine-hollow nalati-grasslands && node --import ./scripts/sim-node-loader.mjs --experimental-transform-types --test test/ci/weather-legacy.proof.mjs test/ci/weather-continuation.proof.mjs'
  check hybrid-render-preparation proof bake-loader.mjs test/ci/hybrid-render-preparation.proof.mjs
  check net-climate proof bake-loader.mjs test/ci/net-climate.proof.mjs
  check quest-seats proof sim-node-loader.mjs test/ci/quest-seats.proof.mjs
  check native-item-frame proof sim-node-loader.mjs test/ci/native-item-frame.proof.mjs
  check declared-input bash -c 'node scripts/pins.ts install nine-dragon-stack && node --import ./scripts/bake-loader.mjs --experimental-transform-types --test test/ci/declared-input.proof.mjs'
fi
check asks node src/scripts/asks.mjs check --all
if [ "$mode" = code ]; then
  check sides pnpm check:sides
  check check-asks pnpm check:asks
  check page-events pnpm check:page-events
  check kit pnpm test:kit
  check hooks pnpm test:hooks
fi
exit "$red"
