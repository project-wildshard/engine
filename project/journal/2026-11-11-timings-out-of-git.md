# Test timings leave git (LAND-SIMPLIFY LS2)

J250 and J258: the measured test seconds are build output. In the 8-hour
audit, 28 of 183 main commits touched a timing file, and the "new test
files need committed timings" refusal bounced pushes that had nothing
wrong with their code.

- `scripts/test-timings.mjs` is the one reader and writer. Main's `ci`
  gains a small `timings` job: it merges the run's shard reports (or, for
  a reused run, the plan branch run's) into the table and saves it as the
  Actions cache entry `timings-<run id>`. Every packed job of a run
  restores the same entry, the newest made before the run started, by
  its exact key. Codex's J206 MUST: jobs planning from different tables
  pack different shards and skip files while green. With no entry, the
  run rebuilds the table from the newest earlier green run's `engine-ci-*`
  artifacts. With neither, it plans every shard on median weights and
  prints a warning. An API failure fails the job, never a split plan.
- Local readers (the split pre-push, the push sequencer, the related-test
  gate, vitest-shard and vitest-plan) read `~/.cache/wildshard/timings`.
  `worktree new` refreshes a missing or day-old table in the background.
- Deleted: the five committed timing files, `push-test-timings.mjs` and
  its reporter and five proofs, `vitest-durations.mjs`, the gate's
  new-file refusal, and land's `WS_PUSH_TIMING_RECORDS`. The queue's
  preflight went too: it was mostly timing and stamp bookkeeping. The
  queue now enqueues without it, and LS7 retires the queue itself.
- The calibration (1.35 wall per file-second, 70 s setup) is now a
  constant in the planner. The CI weights it scales are the same Linux
  clocks the old committed table held (median ratio 1.07).

Tests in `test/test-timings.test.ts` cover the merge, the readers and the
planner's miss path.

The CI shape test in `test/land.test.ts` now allows the one bookkeeping
job: `timings` needs `tests`, runs on main only and never fails the run.
