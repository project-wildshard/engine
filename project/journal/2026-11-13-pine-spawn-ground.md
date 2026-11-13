# Pine's spawn drew its far proxy, not its ground

> Written by: Claude (opus-pinefix), 2026-11-13

Entering Pine Hollow from Shard select showed two tan slopes: Pine's coarse far proxy, drawn over the spawn. The grid
readout said Pine was `playing` with the proxy drawn and zero L1 / L0 tiles.

**Why.** Pine's runtime draws its pines, grass and road, but not its ground: its ground is the cell's own ring tiles
(D189, no `cellGround: 'world'`), and its runtime never joins the client tile registration. DL17 (G872) made the
cell the player stands in skip its tile-view admission, so it would not read a second copy of its files. For Pine that
removed the only thing that draws its ground. Nothing offered Pine's tiles to the rings, the catalogue had no tile for
it, and the far proxy stayed. Nalati is fine because it declares `cellGround: 'world'` and its root hides at once.
Driftwood's Shard select entry plays its own world, not through this path.

**Fix.** `admitsCellTiles` (nearPlaceholderPlan.ts): the runtime-drawn cell skips admission only when its runtime draws
its own ground, through the tile registration or `cellGround: 'world'`. Pine admits its tiles like any neighbour again.
Its root stays visible, since its coverage never reports ready, and the rings mask the proxy quadrant by quadrant as
its tiles arrive.

**Seen in a headless preview.** Pine streams 14 L1 / 16 L0 at the spawn, and the ground is textured on phone and
desktop. Nalati still admits 0 tiles, and Driftwood looks the same before and after. Pine as home pays DL17's
admission reads again; that is the cost of drawing its ground.
