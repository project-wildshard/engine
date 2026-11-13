# 2026-11-12: Shard Select sets the spawn cell

- J300 (meta MULTI-REPO-PLAN), GRID-CROSSING GC20. Jake: "shard select
  should pop you in, should just like change the spawn location…
  keep the non-dev version on shard select."
- `grid/menu.ts` `gridEntryShown` lost its `hosted` input: Infinite
  Wildshard is on the title only with Developer on (or SF22's gates),
  even on a world that hosts the grid. The title no longer asks the
  world to reveal the card.
- `oneWayIn.ts` `worldHosted`: no word in time and no kept answer now
  means the grid, so a grid shard's card on a world build enters its
  cell. Only a world known to open one cell (heard, or kept per device)
  keeps GO4's one-shard page. Off-grid shards are unchanged (OF3).
- Prod before GC16, first visit, late word: a Nalati tap goes to the
  grid, the door seats the device in Driftwood and the page re-enters
  there, instead of the old one-shard page bouncing to the title. The
  late word is kept, so the next launch takes the one-shard page.
- Seam for OFFLINE OF2: a goto grid page goes online through
  `gotoHosted()`; a recovery reload has no goto and still asks
  `worldHostsGrid`, which on a slow link picks the solo grid. OF2's
  "world builds are always online" removes that.
