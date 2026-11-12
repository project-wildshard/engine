# 2026-11-12 shard wall: shared set-up only, and AMBER under 2x (EV3c, opus-shard1)

- Why: `tests (1)` failed the five-minute shard wall on runs 43315974456 (shards 9, 11)
  and 43318910290 (shards 1, 10) with no test red. Each shard ran 132-142 s but was
  charged ~168 s of set-up: ~100 s of it is "Scan the complete incoming history", one
  of the checks only job 1 runs.
- Change: `ci.yml` times job 1's own checks (quarantine dates, lift-pending, history
  scan, changelog) into `WS_CI_JOB_OWN_MS`; `ci-pack.mjs` `sharedSetupMs` takes it off
  the shard clock, so every shard is charged the set-up all jobs share, plus pins.
- J295 for the wall: over 300 s is AMBER (one `::warning::` plus an AMBER line from
  `--check-walls`, job green); red at 2x, where the in-shard gate now stops it. No
  24 h / 12-run streak for walls: shard numbers change with every plan.
