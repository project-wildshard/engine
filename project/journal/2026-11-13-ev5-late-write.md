# EV5: a write from a session the page had ended (opus-ev5)

- `test/standalone-refused-save.test.ts` "nalati-grasslands: ... the next save stands" went red at `next.flag` on ci 43273336099
  (a TS10 strike) and on main ci 43417164994; receipts had called it a load flake.
- The cause: raising `kept.flag` also queues a TE-ENG8 progress save behind the page's own save. The server posts the page's
  `saved` and, in the same turn, that progress save's `write`. The page ends the session on `saved`, but Node's port still hands
  it the `write`. Load decides whether the progress save queues behind the page's at all; when it does, its write lands after
  the test's "later build" step and after the next session had read storage: a
  restorable copy of the first world at tick 10-12, with `kept.flag` only. The next session started fresh after the refusal
  (tick 0) and saved `next.flag` at tick 6, so the third boot took the stale copy, newest by world tick.
- The fix: the shell drops every message once `dispose` ran, as a reload drops a terminated worker's. A new case plants the
  race (`saved` and `write` in one turn, dispose on `saved`): red 3/3 without the fix, green with it.
- Load proof (8-12 parallel runs of the file beside 12-20 node busy loops on 18 cores): before 11 of 32 and 8 of 24 red;
  after 0 of 32, 0 of 24 and 0 of 40.
- The other two EV5 files were fixed before this row: `dedicated-names` by `452a8b0e` (FL25, the tag die) and
  `online-shell` by `c7750b3d` (FL27, a quit the door dropped). Both 24 of 24 green under the same load.
