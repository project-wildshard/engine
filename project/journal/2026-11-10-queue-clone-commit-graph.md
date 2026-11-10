# Push queue: batch clones ignore the reference snapshot's commit-graph

At 18:34 UTC every engine push-queue batch, jobs 222 to 234 including the CI21
lift-pending extension, failed in one sweep as "Queue infrastructure": `git
clone --reference-if-able <snapshot> --dissociate <origin>` printed "unable to
parse commit 398201f" (origin main) and "Clone succeeded, but checkout
failed".

The snapshot's queue stamp commit lets git's auto-maintenance write a commit-
graph into the snapshot. Once a snapshot is captured on top of the current
origin main, that graph holds origin's tip. `--dissociate` closes the
reference's graph while commits parsed from it still need it for their trees,
so checkout can't parse the tip; git fixed this upstream in 3d8e400. It
reproduces on git 2.54 with a live snapshot: the same clone works without
`--dissociate`, and works with `-c core.commitGraph=false`. A plain-path
remote takes git's local shortcut and doesn't reproduce; a `file://` remote
does, like the real ssh one.

`scripts/push-queue-clone.mjs` now clones the batch origin with the commit-
graph off. The clone never needs it and the resulting repository keeps no
trace of the setting. `test/push-queue-clone.test.ts` builds that snapshot and
fails with the same error without the fix. The batch proof stays green.

The first queue run (job 244) passed the full suite but the gate refused the
new test file without committed clocks; its own measured timings are recorded.
