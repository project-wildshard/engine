# land judges only blocking CI jobs

Coordinator, 2026-11-10: opus-gridonline's `land` stopped on runs
42925077011/42925077103 and the stop line listed `quarantine (1)`, `(2)`
first. Those jobs are continue-on-error (J193, J200) and never fail a run
alone; the real reds there were `tests (4)`, `(8)`, `(14)`, my worktree
guard on Linux (fixed by c3de0f7). Still, `land` now splits a red run's
failed jobs: quarantine jobs are named as non-blocking, a run red only from
them counts as green, and a run whose failed jobs can't be listed stays red.
Also: the commit-entry worktree test checks `git`'s exit status (J206
SHOULD on 983d09e).

J206 Codex review (three MUSTs): don't override the run conclusion with a job
list at all. Pages, re-runs and cancelled runs can hide a blocking failure,
and main's reuse requires real run success anyway. Quarantine jobs can't make
a run red alone (continue-on-error), so the conclusion stays authoritative and
`land` only names quarantine reds as non-blocking in its stop line.
