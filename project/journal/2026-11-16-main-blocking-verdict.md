# Judge blocking jobs when advisory reporting fails

> Written by: Codex
> **State:** verified locally, 2026-11-16. M2 CI quick win.

The earlier advisory filter removed timings/quarantine from the failed
job names, but judge and follow still used the whole workflow's red
conclusion. Normalize completed runs only when every blocking job is
green, skipped or neutral and an advisory job actually failed. Keep
unknown, empty, pending, cancelled and genuinely red evidence red or
pending. Do not change workflow selection or any test budget.

Cache checked terminal verdicts in the existing shared run cache by
run id and attempt, so another follower or refresh does not reread
every failed run's jobs. A rerun attempt reads its own jobs again.
All eighteen watcher cases, owning lint and layer typechecks pass.
The new controls cover both sweep and follow, including all unsafe
cases that must never become green.

J381: SKIP_CHECK=1 for the coordinator's main-red deadlock, following
focused local controls and typecheck. Main CI retains the full suite.
