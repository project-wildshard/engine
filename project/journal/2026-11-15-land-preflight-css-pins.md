# land preflight: check-css and a first pnpm pins (buddy-engine)

- opus-gcm11's lands, 2026-11-15:
  - `scripts/check-css.mjs` runs in CI's static job (`ci-static.sh`) but not in the pre-push, so a CSS slip cost a
    27-minute re-run.
  - A worktree that never ran `pnpm pins` has no `out/.pins.json`, so `gen.mjs --inputs-only` fails.
- The preflight now runs `node scripts/check-css.mjs` after lint:game (it takes under a second). A tree without that
  script, such as a fixture, skips the step.
- Before gen:inputs, land runs `pnpm pins` when the repo has a `pins` script and the ledger is missing. It does this
  even with `--no-preflight`, since gen:inputs needs pins either way. A failed pins stops land with its last lines and a
  receipt.
- Tests: a planted red check-css stops land before any push; a worktree with no pins ledger runs pins first, and one
  with the ledger does not.
