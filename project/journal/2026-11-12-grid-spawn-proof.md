# The 25-cell spawn proof (opus-gc21, 2026-11-12)

- GRID-CROSSING GC21 (J300): `scripts/grid-spawn-proof.mjs` checks Jake's ask that Shard Select pops a player into any of
  the grid's 25 cells on staging. Per cell, desktop and phone, a fresh headless Chromium profile runs title, SHARD SELECT,
  the card, ENTER WORLD, then control, a 10 m walk by input, a jump, and the server's own seat cell (`__workerClient().cell`,
  1-based into the grid catalogue). It reads the catalogue at staging's own build, since lanes edit the working copy.
- A locked card is tried again with Developer on. A fresh `/?chunk=` visit is no way round a missing card: it lands on the
  title's deck.
- The first run on staging serial 76 (b3e9a56, before GC20) was 3 of 50 green: 18 cells have no card at all (the open plots
  and `_template`), and four are Coming soon or Draft for a player.
- The first pass ran three pages at once and the staging door answered 429 to some of their sockets (4 sockets and 10
  connects a minute per address; every agent on this Mac shares one). A refused page fell back to a one-shard page or
  ended on the title with no word, so carded cells run again one page at a time (`--parallel=1`), and `--again=` lays that
  second run under the first in the report. A walk blocked by a wall now backs up: the 10 m is measured from the start.
