# Orphaned runs lose their CPU slots (opus-fl30, 2026-11-12)

- TEST-SPEED FL30 (meta `docs/plans/TEST-SPEED-PLAN.md`): an orphaned Vitest (ppid 1, 0 % CPU) from opus-lf14's removed
  worktree held 8 of 16 CPU-broker slots overnight, so every `CPU_EXCLUSIVE` file timed out with "Expected lease".
- Cause: a `cpuActive` row carried only the broker's pid and `acquire_cpu` pruned only dead pids. The broker lives while
  its parent's stdin pipe is open, so an orphaned parent kept the lease forever.
- Fix: the client sends its pid; each row records holder, owner (the broker's parent) and repo. `acquire_cpu` reclaims a
  row whose process, holder or owner is gone, whose checkout no longer exists, or whose owner is orphaned (ppid 1) with no
  CPU progress across its tree for 60 s, then SIGTERMs that row's process when its command line is a CPU broker or
  admission script. A busy orphan keeps its lease.
- Found on the way: on Python 3.12+ `server.wait_closed()` waits for open connections, and the broker cancelled its
  clients only after it, so `close()` or a SIGTERM with a lease held hung forever. The broker now cancels first.
- `land.mjs` cleanup stops what still runs in the worktree (not itself, its ancestors or a bare shell) before
  `git worktree remove`; the reaper stops only orphans there, then checks busy as before.
- Proof: `node scripts/cpu-broker-proof.mjs` (red first: dead holder, removed worktree, idle orphan reclaimed in seconds;
  busy orphan kept), `test/tooling/worktree-reap.test.mjs`.
