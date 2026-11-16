# land runs the local checks first (buddy-engine, build-max)

- Build-max 2026-11-15: 22 of 50 lands stopped, 14 of them on checks
  that run locally. Each paid for a plan push and a CI wait first.
- `scripts/land.mjs` now runs a preflight after its rebase and stamps,
  before the plan push: `pnpm lint:game`, `pnpm typecheck`, then
  `pnpm exec vitest related --run` on the branch's changed code
  (`src`, `test`, `scripts`). A docs-only branch skips Vitest.
- A red check stops land with nothing pushed. The stop line and the
  receipt name the log, which sits in the worktree's git dir
  (`.git/worktrees/<slug>/land-preflight/`). That keeps it out of the
  tree, and it goes when the worktree does. `--no-preflight` skips the
  preflight.
- The method is `localChecks`: `Landing.preflight` was already the
  clean-tree check, and a second method of that name silently replaced
  it (codex-netlag saw the duplicate in lint).
- Tests: the order and the files, a red stop with no push and its log,
  and `--no-preflight`. The two rebase-install tests count pnpm calls,
  so they run with `--no-preflight`.
