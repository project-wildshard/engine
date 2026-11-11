# main-watch reports main's CI (LAND-SIMPLIFY LS5, first half)

J258: land should return as soon as main is pushed, and a small watcher
reports main's ci result, "a receipt line + a direct message to that
agent" on red. Built first; land's own wait goes in LS5 once this has run.

- `scripts/main-watch.mjs` judges every finished main `ci` run once
  (state in `~/.cache/wildshard/main-watch.json`). Green gives a receipt.
  Red gives one `MAIN RED <range>` receipt naming the landers of the
  commits in that range (from their `landed` receipts) and a
  `herdr pane run` message to each lander's pane. A cancelled run with a
  later run is "superseded", never red. One with nothing newer gets `ci`
  dispatched on main, once.
- land starts `main-watch --follow=<sha> --lane --pane` in the
  background after it lands, from the canonical checkout, so it outlives
  the worktree. By hand, or from the coordinator's tick:
  `node scripts/main-watch.mjs`.
- A first run with no state takes every finished run as already judged,
  so it doesn't replay old reds.

Replaying 2026-11-11's cancelled runs 42965336189 and 42966114949 gives
two "superseded" lines and no MAIN RED (`test/main-watch.test.ts`).

J206 Codex review, 6 MUSTs fixed: a first follow keeps its own SHA's runs
out of the baseline; a follow sweeps on every poll, so a cancelled tip is
dispatched and a superseding run seen; the lock holds a pid and only a dead
owner's lock is taken, by rename; each run is recorded after its report is
built and before it is sent; a dispatched re-run's range starts at the last
other SHA.
