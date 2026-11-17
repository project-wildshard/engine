# Main watcher and the advisory street runner

> Written by: Codex
> **State:** repaired locally, 2026-11-17 13:04 Cancún.

Run 44139343442 on main 9b016e2ccb passed all twelve blocking jobs.
GitHub cancelled the advisory macOS street job after assigning no
runner and running zero steps. Its aggregate workflow result was failure.
The watcher knew only timings and quarantine were advisory, so it sent a
MAIN RED without naming a failed job.

Recognize the exact hosted street job already declared report-only in
ci.yml. A failed, timed-out or cancelled advisory cannot overrule passed
blocking work. Keep failed, cancelled, incomplete and unknown blocking
work red, and preserve whole-workflow cancellations. Use the same job
classification when naming failures. Version the cached classification
so a restarted watcher rechecks verdicts from the previous policy.

The thirteen-job replay failed before the change; all twenty watcher
cases pass afterward. Controls individually fail or cancel each of the
twelve required jobs and preserve its red result. No workflow, timing,
renderer, benchmark threshold or pin policy changes.

Original workflow 44139343442 remains an aggregate GitHub failure with
an advisory cancellation. Original run 44137015477 attempt 1 remains a
real checkout-wall red; codex-shards owns repair 319ec264. Its separate
hosted street page-state failure remains unresolved. The exact producer
client passes the unchanged street benchmark on the mini's physical GPU;
meta's NB6 evidence retains that control without claiming a hosted fix.
