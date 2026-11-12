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
