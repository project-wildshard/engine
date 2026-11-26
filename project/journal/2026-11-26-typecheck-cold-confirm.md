# The commit typecheck confirms a red build from cold (opus-grid105, meta QA 11-25 row 104)

- Lanes committed with `SKIP_CHECK=1` because the commit hook's typecheck refused 17 errors in four test files
  (memory-ratchet, nalati-qara-handoff, script-despawn, the plain-perch fixture) while main CI's types check was green.
- Scope was never the gap: the hook runs `pnpm typecheck` (minus another lane's untracked files) and CI static runs
  `pnpm typecheck`, the same configs. The gap is the cache. CI builds cold; the hook builds over the checkout's warm
  `.tsc-layers`. Row 99's worktree cache had `root-tests.tsbuildinfo` holding semantic errors for those four files,
  every input hash equal to a cold build's, and `tsc -b` replays a cached error for any file whose hash didn't change.
  A same-depth copy of that worktree reproduced 17 errors warm and 0 with the cache removed.
- So a red `tsc -b` segment is now confirmed with `--force` before the hook refuses (about 30 to 60 s, only on red):
  the hook refuses only what a cold build, CI's, refuses, and the rebuild heals the cache. On the row 99 copy: 17
  replayed, cold clean, exit 0 in 31 s.
- The test: a stale diagnostic written into a tiny project's buildinfo passes the hook and heals; a real error fails
  warm and cold; and the hook's `typecheck` script, CI static's `check typecheck pnpm typecheck` and the push gate's
  spelled-out typecheck commands must name the same tsc configs.
