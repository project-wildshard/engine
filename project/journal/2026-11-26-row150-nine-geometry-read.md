# QA 11-25 row 150: Nine's hosted geometry read never settled on frames

> Written by: Claude (opus-nine133), 2026-11-26. State: done, meta QA 11-25 row 150.

main-watch flagged `nine/boot/retained-geometry` at 17.06 MB against the
8.32 MB line at `1a1719bca` (row 133's land). That commit added no
geometry:

- Its far fallback runs only when the baked `far.json` answers 404. CI's
  nine-ring1 client (run 45811563772's artifact) serves
  `assets/baked/nine-dragon-stack/far.json`, so the cell reads it as
  before. The lent-uniform change lays a post pass, no scene geometry.
- That exact client, read locally (SwiftShader, one-cell Nine), retains
  6.82 MB at control, the baseline to the byte, and 6.06 MB after 109
  frames. With the CPU throttled 8x: 7.85 MB at control, 7.09 MB after 156
  frames (Nine's hidden fei-zhua hooks, 0.91 MB, held or not by run).
- Every hosted read on main adds up to the same 57.9 MB, retained plus
  released: 14.15 + 43.75 at `ddd80ffd5` and `d0d3564f4` (before row
  133), 17.06 + 40.85 at `1a1719bca` and `2492a13dd`, 15.86 + 42.04,
  14.09 + 43.81 and 12.12 + 45.78 since. What moves is the frames drawn
  by the read: 3 to 12.

So the hosted read has never met row 122's line, which came from local
reads. Row 122's `releaseDrawn` lets go of drawn copies, and freed 0 MB
in every hosted run: the extra is geometry not yet drawn. Hosted
SwiftShader draws a frame every few seconds, so the settle's 3 s with no
change passed between two frames, before the after-control build's
copies were drawn and let go.

`nine-load.mjs` `waitNineSettled` now also needs `NINE_SETTLE_FRAMES`
(20) drawn frames with the read unchanged, capped at 90 s (the 10 min
job keeps its readiness cap and non-boot work). `releaseDrawnThenRead`
returns the page's frame count for it. The read logs and writes
`retainedGeometryOwners` (`boot-memory-ratchet.mjs`): the retained bytes
by owner, so the next moved read names who holds it.

Tests: `test/nine-load.test.ts` (a hosted page drawing a frame every
3.5 s reads 6.8 MB, where the time-only settle read 17), and
`test/boot-memory-ratchet.test.ts` (owners, hidden subtrees, a shared
store counted once).
