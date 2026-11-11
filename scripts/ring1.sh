#!/usr/bin/env bash
# Ring 1, what a push must pass, as one command: `bash scripts/ring1.sh [static|tests|cook-step|build-boot|build|boot|products|all]`. ci.yml runs cook-step, build and boot as one
# products unit (scripts/ci-pack.mjs), so a local run of those is the same work. Each stage prints its seconds, and a red one doesn't hide the rest. It needs no shard
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
  stage page-events pnpm check:page-events
}

tests() {
  stage pins node scripts/pins.ts install --ring 1
  stage inputs pnpm gen:inputs
  WILDSHARD_RING=1 stage tests python3 scripts/heavy-lane.py full-test -- pnpm test
}

cook_step() {
  set --
  if [ "${RING_RECORD:-}" = true ]; then set -- --update; fi
  stage pins node scripts/pins.ts install --ring 1
  stage cook node scripts/ring-cook.mjs
  stage step node --experimental-transform-types --no-warnings scripts/ring-step.ts --report tmp/ring-cook/step.json "$@"
}

build() {
  stage pins node scripts/pins.ts install --ring 1
  stage build pnpm build:ring
}

boot() {
  # Title to play on all three. The grid case isn't here: on three products it stalls at `home`, so road crossings stay in Ring 2 until row 7.
  # RING_BOOT_JOBS=N boots N side by side, each in its own browser (BROWSER-TESTS-BENCH BB2, J231). One at a time stays the
  # default: SwiftShader is CPU-bound on the 4-vCPU runner, so 2 or 3 at once took the same ~105 s and doubled Sunscar's
  # time to title (bench run 42913701526).
  WILDSHARD_RING=1 stage boot node scripts/parity/boot-smoke.mjs --case-group=developer --jobs="${RING_BOOT_JOBS:-1}"
}

build_boot() {
  build
  boot
}

products() {
  cook_step
  build_boot
}

case "${1:-all}" in
  static) static ;;
  tests) tests ;;
  products) products ;;
  cook-step) cook_step ;;
  build-boot) build_boot ;;
  build) build ;;
  boot) boot ;;
  all)
    static
    tests
    products
    ;;
  *)
    echo 'usage: ring1.sh [static|tests|cook-step|build-boot|build|boot|products|all]' >&2
    exit 2
    ;;
esac
exit "$red"
