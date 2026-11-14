# Grid crossing M1: proving what is built

> Written by: Claude (opus-gcm1), 2026-11-13

- GC32: `test/grid-crossing-turn-back.test.ts` pins the page's crossing coordinator when a target refuses (Far Reach,
  or a cell on another worker): turning back settles home in the cell or crosses back in from the road, and a blocked
  target asked again retries. Red under two mutants (no settle home; a blocked crossing that sticks).
- GC23, GC24, GC29: `grid-crossing-walk-proof.mjs` gains `--layout=phone` (Jake's iPhone layout, phone tier) with the
  page's memory read at every control (heap, grid resident and playing MB, owner ledger, the memory warning), `--solo`
  (the two shards' one-shard pages read the same way), `--to=nightmarket` (Night Market from Nine Dragon, by its own
  card) and `--place` (the approach set by the in-page harness pose: preview or a loopback page only; an online page's
  `place` is idle). Pine's approach now goes round the west entryway's pier: the old routes swam under the pier that
  runs along z 0 and stuck there.
- GC1: `scripts/grid-crossing-qa.mjs` is the crossing harness as one command: the walk proof in Chromium and WebKit at
  desktop and phone, one JSON row each (`rows.json`: per leg line-to-control, worst stop, long frames, programs linked,
  memory at control) beside the shots, under `~/.cache/wildshard/plan-artifacts/grid-crossing/`.
- GC2: the walk proof's `--breach` throws the wall cases at a closed wall from where the last leg is held: jump into it,
  jump along it both ways, boost-jump into it; a case holds when the page never enters the target and the walker stays
  on the road, standing.
