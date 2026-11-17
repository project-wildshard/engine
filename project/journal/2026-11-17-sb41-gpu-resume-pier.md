# A GPU recovery resumes where the player stood (SB41, buddy-engine)

- Staging v0.1.36, 2 of 2 (opus-closeout1, SENTRY-TRIAGE S22): the S13
  reload kept the world, but the player came back on the road at
  (285,0), not on Driftwood's pier at (1,-194).
- (284.85, 0) is the home's road lane: `recoveryRoad()` before any road
  visit. A resume takes it when the saved place is `{kind: 'road'}`.
  `saveLocation` decided "inside" by comparing the cell under the feet
  with `live.current()`. On a wire the server decides crossings
  (`followServer`), so the page can stand in Driftwood with no entered
  region, `current()` null. That never equals `driftwood-isle`, so the
  pier was saved as road.
- Now, with `current()` null, the cell under the feet is the place. The
  reload's owned-home entry (`enterInitialHome`, which runs because a
  `cell` place needs the home) makes that cell current before
  `resumeRecovery` checks it. A page standing on the road between cells
  still saves `road`.
- Red first in `test/grid-gpu-recovery-online.test.ts`: the pier with
  no region entered saved `road`; it saves `cell` (1, 2.02, -194) now.
- Five tests in `grid-stale-product-recovery` and
  `standalone-page-saves` fail in this checkout with or without the
  change ("No shard source and no pinned product: pastel-plain").
- Done when: the proof passes on a staging build with this commit, then
  S22 reruns.
