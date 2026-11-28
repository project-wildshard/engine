# 2026-11-28: a full push gate that starts can finish

- Meta QA 11-26 row 77. opus-ship's `release/v0.1.101` push of `22862d1b7` went STUCK in `vitest (full)` at 15 min
  twice at load 10-12 (04:42 and 04:59 UTC), after QA70 (88dbe419f) had raised that cap to 1,486 s.
- Why: the gate runs the pushed commit's own `.githooks/push-checks.mjs` in a clean copy of it. The release branch was
  cut from 719ceebac (18:07), before QA70 (19:41), so its push ran the old gate: 4 workers and 900 s. QA70's cap never
  ran on it. Release branches cut after this commit carry the new rule; an older one keeps its own gate.
- The old gate had no admission rule at all: it scaled the limit by load over cores (10.7 / 18 is under 1, so none).
- Now `fullSuiteAdmission` reads the 1-minute load at admission: the workers are the cores it leaves free, between a
  quarter and half the cores, and the stuck limit is 2x the timings table's wall on those workers (load 10.7: 7 workers,
  1,911 s). Under that floor the run waits for the load, sampled every 30 s, up to 10 min (`WS_GATE_FULL_WAIT_S`), then
  starts on its floor with the floor's limit. `WS_GATE_FULL_WORKERS` pins the workers. Hosted CI never waits.
- With no timings table the full limit was the bare 900 s again; it now falls back to the suite's size (6,700 s).
