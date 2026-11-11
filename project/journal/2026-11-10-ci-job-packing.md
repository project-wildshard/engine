# CI-JOB-PACKING (J244): one workflow, six jobs a push

Jake, 2026-11-10: "The fewer jobs we run per commit, the more commits can get
a green CI in parallel." Then: "Do we really want 37 jobs per commit? That's
fucking insane." And, approving the merge: "we want to do zero duplicate work
in ring one from CI… 38→N, yeah, that's the goal." One engine push was 38
jobs (ci 21, ring-1 16, engine-boundaries 1) on an org that runs 20 at once.
Plan: meta `docs/plans/CI-JOB-PACKING-PLAN.md`.

What the spikes found on the 4-vCPU, 16 GB runner:

- `heavy-lane.py` admits one full-test per machine, so shards packed into one
  job queued on one lock (spike 1). Each unit now gets its own scheduler.
- Two shards at once really sharing the runner pushed four files past the 60 s
  cap and failed a timing proof (run 42955579476). So a job runs its shards
  one at a time, as the planner assumes; the saving is the set-up per job and
  the duplicate work, not in-job parallelism.

The shape: `ci` is five `tests (N)` shares plus one non-blocking `quarantine`
job. Each share gates itself (reuse, docs-only), plans the same suite with
exclusions judged at the run's start, and runs its longest-first share:
static, e2e, plan proofs, shards, Ring 1's products and the boundaries report.
Ring 1's own static, plan, quarantine and test shards were ci's work again
(NJ2), so they're gone. `scripts/ci-proof-jobs.mjs` says which runs prove
code: every share green with its packed step run, or the old shape.
