> Written by: Claude (opus-grid)

# 2026-11-24: the worktree tool always runs origin/main's copy (J505)

Jake, 2026-11-23 ~20:40 Cancún: *"make it a permanent fix ... No queues. No freezing, no waiting, make it all
permanent."* The canonical engine checkout sat about 490 commits behind origin/main, so `node scripts/worktree.mjs new`
run there still capped worktrees at 6 after main raised the cap to 10, and lanes made worktrees by hand.

`scripts/worktree-fresh.mjs`: before anything else, worktree.mjs fetches origin main and compares every file it runs
(`WORKTREE_TOOL`, held to the real import graph by a test) with origin/main's blobs. Any difference exports origin/main's
`scripts/` and `.agents/hooks/` into `<canonical>/tmp/worktree-tool/<sha>/` and runs that copy with the same arguments
and working directory (`WS_WORKTREE_FRESH=1` stops a second relaunch; older exports are pruned). When the export cannot
be made it stops with the exact by-hand command. A tool run against another repo (the test fixtures) runs as it is.

This takes effect once the canonical checkout has this file: the first stale run after a fast-forward is the last one.
Test: `test/tooling/worktree-fresh.test.mjs` (a clone behind its origin runs the newer tool; its own copy stays as is).
