# 2026-11-14: worktree receipts carry their disk cost (REPO-DISK DK10, DK11)

- `worktree new` now writes `df` free before and after and the worktree's `du` into `tmp/worktree-setup.json` and
  its receipt line. Build output inside a worktree is cloned (pins) or built there, so `du` shows the full size while
  `df` shows what it really cost; the plan's bound is 150 MiB at ready and 500 MiB after a `build:game`.
- `worktree reap` records the `df` change of each real run in its receipt (a measure: other lanes write meanwhile),
  and names every unlanded or dirty worktree untouched for `--stale` hours (72 by default) with its `du` size, so
  the coordinator's brief can put it to its owner. The test now plants `tmp/` scratch in the reaped worktree and
  checks it went with it.
- The reaper is repo-kit's `files/scripts/worktree-reap.mjs`, byte for byte; `worktree.mjs` takes the same change
  as the kit's copy.
- Review (J206): the stale list skips a worktree with a process inside or a dirty path changed recently (Git
  state alone missed days of uncommitted edits); all `du` calls in one reap share a 60 s budget; a change under half a
  MiB prints `+0`, not `-0`.
