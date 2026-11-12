# 2026-11-12 boundaries gets its own non-blocking CI job (EV3b, opus-ev3b)

- Why: EV3 gave products the last packed job, `tests (6)`, but boundaries (J186's
  report-only cook-to-play) ran after products there and takes 223-338 s, not the 32 s
  `UNIT_SECONDS` said. `tests (6)` stayed the long pole at 13.7 min (run 43295196045).
- Change: boundaries needs nothing products makes: it installs Ring 1's pins and
  Chromium itself and builds its own tree from `git archive HEAD`. So `ci.yml` runs it
  as its own `boundaries` job from t=0, `continue-on-error` like quarantine, through
  `ci-pack.mjs --units=boundaries`. It still needs the full `pnpm pins` first: its first
  run skipped them and the Ring 1 cook missed a raw tarball (run 43303094170). The unit now starts Chromium's install itself (`ci-browser.sh`), as
  products does. `UNIT_SECONDS.boundaries` is 300. land's `failedJobs` counts a red
  `boundaries` job as non-blocking.
- Expected: products job about 8.5 min; the long pole becomes the slowest shard job.

## Measured, and shards fill the products job (EV3b, opus-ev3c)

- Measured on main after the Brasscap back-out: products job 5.2-8.1 min, boundaries
  job 5.4-6.9 min (unit 258-392 s, p50 320, now `UNIT_SECONDS.boundaries`). But jobs 1-5
  ran 9.6-11.3 min: the plan grew to 14-15 shards and one job got four of them
  (runs 43313302390 .. 43315974456). Longest blocking job p50 10.4 min over 4 green runs.
- Change: products still starts the last job (and runs after its shards, which it must,
  since it swaps the full pins for Ring 1's), but `packUnits` now packs the other units
  over all six jobs. On run 43315969089's measured seconds the heaviest share drops from
  about 613 s to about 440 s.
