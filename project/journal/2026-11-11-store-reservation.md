# Engine entry points respect a pnpm store prune

Meta GVS-PLAN G10 (J230): a store prune must never run under an install,
gate or lease, and none may start under it. Meta `make prune`
(`scripts/prune-store.sh`) takes an exclusive flock on
`~/.cache/wildshard/store-maintenance.lock`, which its `pnpm store prune`
child inherits, then scans the machine. Engine's entry points do the
reverse: announce, then probe the lock.

- `heavy-lane.py`: a lease writes its `*.active.json`, then checks; while
  a prune holds the lock it backs out (files, locks) and stays queued.
- `cpu-admission.py`: a grant is saved, then checked; while a prune holds
  the lock it is given back and the caller waits.
- `worktree.mjs new`: the install writes `store-users/<pid>.json`, then
  probes (through Python, since Node has no flock) and refuses while a
  prune runs.

A held lock instead of a PID file came from the J206 review: a killed
prune wrapper leaves its pnpm child running, and a PID can be reused.
Tests: a lease waits through a prune whose owner was killed and runs once
the inherited child ends; CPU admission waits and then runs; a worktree
install refuses under a held lock and runs under a free one. All failed
on the old scripts.

The same day a real `make prune` showed pnpm prunes what only
classic-layout checkouts use, which broke `pnpm install --offline` until
the store was refilled; the meta script now refuses while any classic
checkout remains (until G9).
