# The verb-tape worker's fence scales with load (buddy-engine)

- `test/headless-verb-tape-worker.test.ts` runs six real SDK workers in
  a child under a fixed 20 s `spawnSync` fence. Alone it passes in about
  9 s at load 23-32 on 18 cores. Under other lanes' gates (load 35-50)
  its cold first tick ran past 20 s and reddened three pre-pushes
  (codex-netlag 13:49 and 14:38 UTC, opus-publish1 14:56 UTC), each
  pushed through with a J381 hatch.
- Every simulation in the child already uses an advisory deadline, so
  the parent's clock is the only timing; nothing it asserts is about
  speed. `loadScaledMs` (`test/fixtures/loadBudget.ts`) scales the fence
  by the larger of the 1- and 5-minute load per core, between 1x and 4x
  (20 to 80 s). An idle or hosted runner keeps exactly 20 s. Vitest's
  timeout is the fence plus 5 s.
- I kept it as a local native file rather than moving it to the
  hosted-only timing set: it is a correctness proof the split gate
  should still run on a related change.
