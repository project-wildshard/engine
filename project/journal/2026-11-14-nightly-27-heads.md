# Nightly stopped at plan on a hard 28 (buddy-engine)

- Found while checking TEST-COVERAGE row 8 (crater). The 11-13 nightly
  stopped in `tests` and `report` with
  `Ring 2 requires 28 distinct pinned heads`: `scripts/nightly-model.ts`
  hard-coded 28, and `8f613824` dropped open-plot-showcase-template
  from the pins (27), so no head ran at all.
- The guard's job is "every pinned head, none twice", so it now checks
  distinct, non-empty slugs and takes the count from the pins file.
- `test/nightly-plan.test.ts`: the plan's heads equal the pins file's
  slugs, each once. Red on the old guard (plan() threw).
- Still red beneath it, not touched here: 11-11 and 11-12 failed `tests`
  on `Lift-pending ownership requires complete introducing history`, and
  heads timed out (`nalati-grasslands`, `pine-hollow`: past 300 s).
