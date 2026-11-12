# One fall floor for the page and the room (SERVER-PARITY SS6)

> Written by: Claude (opus-ss6), 2026-11-12

The page and the room caught falls at different heights. The page reads its play area from the manifest's bounds,
then from the `client/plan` rows that override them. The room read only the manifest's floor.

- Sky Reach's `player.enter` sets the page's floor to −8 and its area to ±250. The room reset everyone below 12.
- Nine Dragon's `world.runtime-hooks` keeps the manifest's floor (25) near the middle and drops it to −20 past 200 m.
  The room said 25 everywhere.

Online, the page stops checking falls and the room does it, so players got snapped back where the page let them fall.

- `src/shared/game/shardfile/playArea.ts` (new) picks the play area the page picks: runtime hooks over
  `player.enter` over the manifest, the same order the page installs them in. The page's runtime hooks now use its
  `outerFloor` rule too.
- `FallFloor` takes a `PlayArea`, or a bare number for the road, and reads the floor at the player's x/z. It does not
  enforce the area's x/z edge. A first cut did, and `test/standalone-grid-lone.test.ts` went red: a lone cell lets a
  Dunes player walk past its ±200 area to the wall at 250. The page's offline x/z reset stays the page's for now.
- `cellWorld` builds each seat's floor from `shardPlayArea(manifest bounds, product)`.
- `test/fall-floor-parity.test.ts` steps the page's real feature installs and `installBounds` beside a lone room's
  `FallFloor`, and checks they reset on the same tick. On main, 2 of its 4 cases were red: Sky Reach at y 5 and Nine
  Dragon 220 m out. ENG-18's room test now expects the page's floor for Sky Reach.

Left open: `residentFallNet` (bare headless residents: tapes, bake, shard CI) still gets the manifest's floor from
`headlessRuntime.ts`. It already takes a `PlayArea`. Passing `shardPlayArea(...)` there is one line, but another lane
(HS2) had that file open, so it waits for a later row. It is not on the wire, so players don't see it.
