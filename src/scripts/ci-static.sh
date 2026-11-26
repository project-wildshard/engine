#!/usr/bin/env bash
# CI-JOB-PACKING (J244): ci's static checks as one command, so a packed job runs them as one unit beside its test shards.
#   bash src/scripts/ci-static.sh code   every check a code push needs (the old `static` job, step for step)
#   bash src/scripts/ci-static.sh docs   what a docs-only push still runs: lint, format, the committed asks, agent parity
#                                    (it reads AGENTS.md and CLAUDE.md) and $DOCS_TESTS, the tests that read a changed doc (EV9)
# Each check prints its seconds; a red one doesn't hide the rest, and any red makes the exit code 1.
# Run it before `pnpm pins`: some proofs install their own few pins, which replaces the published mounts.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
red=0
check() {
  local name=$1 started=$SECONDS
  shift
  echo "::group::static: $name"
  if "$@"; then echo "::endgroup::"; echo "static: $name green in $((SECONDS - started))s"
  else echo "::endgroup::"; echo "::error title=static $name::red after $((SECONDS - started))s"; red=1; fi
}
proof() { local loader=$1; shift; node --import "./src/scripts/$loader" --test "$@"; }
# TC26 (J186, AD1): the fire drill soaked 414 clean ci-reports runs, 11-17 to 11-23. Static runs before `pnpm pins` and
# gen, so it installs Nalati and publishes Rapier's binary itself, and Brasscap, whose tracked pin broken-tar reads now the
# format ships no whole Brasscap (format 0.79, QA 11-24 row 70).
fire_drill() {
  node src/scripts/pins.ts install nalati-grasslands brasscap-mesa &&
    node --input-type=module -e 'import {copyRapierWasm} from "./vite/rapier.ts"; copyRapierWasm();' &&
    proof bake-loader.mjs test/ci/coverage-fire-drill.proof.mjs
}

mode=${1:-code}
case "$mode" in code|docs) ;; *) echo 'usage: ci-static.sh [code|docs]' >&2; exit 2 ;; esac
if [ "$mode" = code ]; then check typecheck pnpm typecheck; fi
check lint pnpm lint
check format pnpm format:check
if [ "$mode" = code ]; then
  check entry-model-values proof bake-loader.mjs test/ci/entry-model-values.proof.mjs
  check quest-home-lifetime proof bake-loader.mjs test/ci/quest-home-lifetime.proof.mjs
  check hover-boost proof bake-loader.mjs test/ci/hover-boost.proof.mjs
  check net-exchange bash -c 'node src/scripts/pins.ts install driftwood-isle pine-hollow && node --import ./src/scripts/sim-node-loader.mjs --test test/ci/net-exchange.proof.mjs'
  check native-loadout proof sim-node-loader.mjs test/ci/native-loadout.proof.mjs
  check keyed-sky-clock proof sim-node-loader.mjs test/ci/keyed-sky-clock.proof.mjs
  check interaction-placement proof sim-node-loader.mjs test/ci/interaction-placement.proof.mjs
  check declared-journeys bash -c 'node --import ./src/scripts/sim-node-loader.mjs --test test/ci/declared-journeys.proof.mjs'
  check weather bash -c 'node src/scripts/pins.ts install pine-hollow nalati-grasslands && node --import ./src/scripts/sim-node-loader.mjs --test test/ci/weather-legacy.proof.mjs test/ci/weather-continuation.proof.mjs'
  check hybrid-render-preparation proof bake-loader.mjs test/ci/hybrid-render-preparation.proof.mjs
  check net-climate proof bake-loader.mjs test/ci/net-climate.proof.mjs
  check quest-seats proof sim-node-loader.mjs test/ci/quest-seats.proof.mjs
  check native-item-frame proof sim-node-loader.mjs test/ci/native-item-frame.proof.mjs
  check declared-input bash -c 'node src/scripts/pins.ts install nine-dragon-stack && node --import ./src/scripts/bake-loader.mjs --test test/ci/declared-input.proof.mjs'
  check fire-drill fire_drill
  # TC22 (J186, AD2): the release gate's nightly reader soaked 414 clean ci-reports runs, 11-17 to 11-23.
  check release-nightly node --test --test-timeout=10000 src/scripts/release-nightly.proof.ts
  # XR-3 (J186, AD2): an extra nightly receipt cannot hide behind a green table; 414 clean soak runs, 11-17 to 11-23.
  check nightly-identity node --test --test-name-pattern='extra receipt' src/scripts/nightly.proof.ts
  # EG-24 (J503, AD2 row 43): a socket lost mid-fight or mid-crossing resumes; clean in ci-reports since 11-17.
  check socket-recovery bash -c 'node src/scripts/pins.ts install --ring 1 && node src/scripts/vitest-tmp.ts run test/dedicated-critical-reconnect.proof.ts'
  # TC7 (J503, AD2): the full Dunes and real pin-grid journeys on Ring 1's pins; clean in ci-reports since 11-19.
  check pin-grid-journeys bash -c 'node src/scripts/pins.ts install --ring 1 && node --import ./src/scripts/sim-node-loader.mjs --test test/ci/dunes-journey.proof.mjs test/ci/pin-grid-journey.proof.mjs'
  # TC39 (J503, AD2): the API health version reader over real HTTP; clean in ci-reports since 11-21.
  check api-health env TC39_INSTALLED_FORMAT=1 node --test --test-timeout=10000 src/scripts/api-health.proof.ts
  # EG-12 (J503, AD2 row 30): every elite a Ring 1 product declares has a live server owner; green since 5599f5323.
  check roster-owners bash -c 'node src/scripts/pins.ts install --ring 1 && WILDSHARD_RING=1 node src/scripts/vitest-tmp.ts run test/roster-owners.proof.ts'
  # TC28 (J503, AD2): cook-cache input closure, persistent hit, revision isolation and GC race (no real cook; the
  # nightly's hosted companion cooks for real). Red in nightly 45246927061 until 9a18860d0 drew the double's maps.
  check cook-cache proof bake-loader.mjs src/scripts/cook-cache.proof.ts
  check cooked-retention proof bake-loader.mjs src/scripts/cook-retention.proof.ts
fi
check asks node src/scripts/.kit/asks.mjs check --all
if [ "$mode" = docs ]; then
  check parity pnpm check:parity
  # Space-separated repo paths from src/scripts/ci-selection.mjs. A file the config quarantines
  # is excluded from the full suite too, so zero selected files is green here.
  # shellcheck disable=SC2086
  # A selected reader may open a pinned shard (save-whole-documents seats Driftwood: v0.1.86's release ci went red on
  # "No shard source and no pinned product"), so install the pins first, as the code lane does before its shards.
  if [ -n "${DOCS_TESTS:-}" ]; then
    check doc-pins bash -c 'pnpm pins && pnpm gen:inputs'
    check doc-tests node src/scripts/vitest-tmp.ts run --passWithNoTests $DOCS_TESTS
  fi
fi
if [ "$mode" = code ]; then
  check sides pnpm check:sides
  # OFF-VERCEL OV5: was deploy.yml's prepare step, which never ran on main.
  check css node src/scripts/check-css.mjs
  check agent-markers node src/scripts/.kit/agent-marker-check.mjs
  check check-asks pnpm check:asks
  check page-events pnpm check:page-events
  check wire pnpm check:wire
  check saves pnpm check:saves
  check kit pnpm test:kit
  check hooks node --test '.githooks/*.test.mjs'
  # MULTI-AGENT-TOOLING MA6: one agent layout for Claude Code and Codex (repo-kit agent-sync).
  check agent-sync pnpm check:agent-sync
  check agent-hooks node --test '.agents/hooks/test/*.test.mjs'
  check parity pnpm check:parity
fi
exit "$red"
