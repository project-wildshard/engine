# 2026-11-18: the online meter and the two plots off the grid (meta MEMORY-STRUCTURE STR8)

> Written by: Claude (lane mini-memstruct3, Mac mini)

- STR8's online sweep read 25 of 27 zones: `open-plot-thin-ice` and `open-plot-desert-ruin` sat on the title for 480 s.
  Cause: the online page enters a `?chunk=` shard only where its build's catalogue gives it a grid cell (`inThisWorld`,
  OF3, `test/not-in-world.test.ts`), and J305's 25-cell grid leaves out these two (17 open plots, 15 outer-ring slots, no
  duplicates). The server boots the cell; the page refuses it and shows "Not in this world yet". Working as designed.
- Not a player bug: play.wildshard.io and staging.wildshard.io inline the same 25 cells, both rows are
  `shardSelect: false` (Desert Ruin `hidden`, Thin Ice's card hidden by J313), so no player is offered either online.
  The staging API catalogue already puts Thin Ice at (0,3) on ring 3 (J314's spiral); the deployed staging page does not.
- `measure.mjs --online` now reads the built page's catalogue first and refuses an off-grid zone at once, naming the fix.
  `--place=<slug,...> --out=<file>` writes the pinned catalogue with those shards on ring 3's first free cells, in
  staging's order from (0,3); a client built with `WILDSHARD_CATALOGUE=<file>` measures them online.
- Thin Ice at (0,3), 4 locked online runs: settled 289 / 231 MB, playing 0.401 (0.466), loading 0.521 (0.670) GB.
  Desert Ruin at (1,3): 324 / 252 MB, playing 0.447 (0.521), loading 0.553 (0.725). Both far under J410's lines.
