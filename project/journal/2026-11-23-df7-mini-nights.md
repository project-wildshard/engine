# DF7 nights run on the mini, not on a runner

> Written by: Claude (lane mini-dwfps3)

J467 put the nightly on the mini's `mini-1` runner, but `mini-1` is a Linux
VM with no Metal. A native GitHub runner on the mini's own account would
run any workflow of this public repo next to Jake's files and keys, so the
mini measures main's tip itself from launchd (`scripts/fps/nightly-mini.mjs
--install`, 02:17 Cancún) and dispatches `driftwood-fps.yml`, now a hosted
report job, with the graded night. The summary page shows the table; the
artifact keeps `night.json` for the next night's p95 comparison. GATE stays
`false` until DF15. main-watch turns a red night into a fix-row receipt
naming who pushed since the last green night.
