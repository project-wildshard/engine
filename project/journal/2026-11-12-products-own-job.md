# 2026-11-12 products get their own CI job (EV3, opus-ev3)

- Why: `tests (1)` was the long pole of every hosted `ci` run, p50 12.6 min against
  9.1 for jobs 2-5 (meta HOW-WE-BUILD-PLAN section 0). Packing put Ring 1's products
  (cook, build, boot, about 360 s) in job 1, and products must run after that job's
  shards, because it swaps the full pins for Ring 1's.
- Change: the `tests` matrix grows to six shares. `packUnits` gives `products` (and its
  follower `boundaries`) the last job to itself whenever a run has more than one job;
  static, e2e, the plan proofs and every shard pack over jobs 1-5. One job (a local run)
  still runs everything, products last.
- Every consumer keys on `tests (N)` names and the packed step, so `ci-proof-jobs`,
  exact reuse, land's flaky lookup and main-watch need no change.
- Cost: one more runner per run (8 jobs, not 7) and job 6 repeats the set-up and the
  full `pnpm pins` before products. If job 6 becomes the long pole, the next cut is to
  skip the full pins there (`ring1.sh` installs Ring 1's own).
