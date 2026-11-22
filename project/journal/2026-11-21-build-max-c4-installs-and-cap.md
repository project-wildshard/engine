# Build-max C4: installs follow the lockfile, a full cap makes room

buddy-engine, 2026-11-21, for the Coordinator.

From 14:33 to 16:59 Cancún every push gate's typecheck failed on stale
installs: pnpm-lock.yaml had moved to shard-format 0.67.0 and
node_modules still held 0.66.0. engine-quickfix itself was one of them.
A main-push sync moved the lockfile and nothing installed. Land installs
only when its own rebase changes the lock. The canonical refresh trusts
its own record. None of them noticed an install that fell behind any
other way.

`scripts/install-lag.mjs` compares pnpm-lock.yaml with pnpm's own copy
of what it installed (`node_modules/.pnpm/lock.yaml`). That pair is
right whatever moved the lock. Land checks it after its rebase and
before the gate. main-push checks it after each sync, before the pregate
and before the push. The canonical refresh in worktree.mjs now installs
when that pair disagrees even if its record says current.

The six-worktree cap used to refuse and point at `reap`, which is only
an inventory since J358. Now `worktree new` with a full cap removes the
oldest worktree that is landed, clean, untouched for 30 minutes and has
no process or pidfile inside. It first takes the same keep-copy land
takes before removing its own. A dirty or recent worktree stays. Low
disk still refuses.

The cap case skips the owner session's own liveness on purpose. A lane
between rows keeps its worktree only while something runs in it. Its
work is in the copy, and land makes a new worktree when it needs one.
