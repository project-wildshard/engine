# Road preload proof (ROAD-PRELOAD RP1, J320)

opus-roadpre, 2026-11-13. `scripts/road-preload-proof.mjs` enters a grid
cell from SHARD SELECT on a preview build and walks off its west entryway
onto the road at the phone layout. On f2a636b3 (Driftwood, Chromium and
WebKit) the road is built at control (40 strips, road look landed), but
two holds remain: a ~300 ms frame as the feet cross the cell edge, and a
~310 ms stop at the 10 m line where the road crossing commits and the
traveller's motor rebinds. Both go to meta ROAD-PRELOAD RP4, with
GRID-CROSSING GC34. Bytes: the grid spawn manifest is the authority (the
page's network events miss the spawn download's reads).
