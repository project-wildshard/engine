# Land's main push runs no Vitest (LAND-SIMPLIFY LS3)

J258, Jake: "midway halfway, we run all the fast and cheap stuff,
ignoring vitest, but still run lint & typescript etc." It extends J249,
which waived hosted re-CI after a clean rebase, to the local gate.

- land marks its main push `WS_LAND_MAIN_PUSH=<exact|carried>:<sha>`.
  The SHA binds it (J206 review MUST): a push of anything else keeps the
  full gate.
  `.githooks/run-checks.mjs` reads it through `landMainMode()` and gives
  it its own lane. It applies only when every pushed ref is main, never on
  hosted CI.
- `exact` is the SHA branch CI proved, so nothing more runs. The
  pre-push's history, secrets, size, changelog and AGENTS.md checks
  already ran.
- `carried` (a clean rebase): gen:inputs, then typecheck, lint, format,
  sides, asks and page-events in parallel under the CPU broker. No
  Vitest, no heavy lane.
- A hand main push has no marker and keeps the full gate.
- Deleted: `scripts/push-hosted-green.mjs`, whose exact case the marker
  covers without two GitHub API calls, and the `WS_PUSH_POST_CI` split
  path. The proof-shape assertions now test `provesCode` directly.

Measured on the Mac at load 8: the carried lane takes 13.9 s (lint:game
on 6 threads is 12.9 s of it), against 78 s for the split gate it
replaces. The exact lane takes 0.1 s.

J206 review: the marker binds the SHA land proved, and the lint threads
never exceed what the CPU broker grants one request.
