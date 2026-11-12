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

## SS6b: the grid page and the bare resident

> Written by: Claude (opus-ss6b), 2026-11-12

- The grid page read its home cell's floor once, at the spawn (`homeFallFloor: authoredBounds.floor` in play.ts), so
  Nine Dragon's page said 25 everywhere while its room let a player 220 m out fall to −20. play.ts now hands the live
  grid `declaredPlayArea(bounds, product).floorAt`, and `LiveGridSession.fallFloor()` reads it at the player's
  cell-local x/z each check. An entered runtime region with a product (a neighbour, or the home re-entered) reads
  `declaredPlayArea` the same way, not the hook's getter. The clamp to half a chunk down is the same on both sides.
- `test/fall-floor-parity.test.ts` adds three grid cases, each as the home and as a region: a stubbed live session over
  the page's real `installBounds`, beside a lone room. Nine Dragon 220 m out was red (page tick 0, room 161) with the old
  hand-off; Nine Dragon 150 m out pins the cell-local x/z; Sky Reach at its spawn agrees.
- `residentFallNet` in `headlessRuntime.ts` now gets `shardPlayArea(manifest bounds, product)`, as a room's seats do. Sky
  Reach's bare resident now catches at −8, not 12; its 0.25 s grace carries a dropped player about 12 m under that, so
  `test/fall-net.test.ts` allows a resident the grace's fall.
- Still open: a grid neighbour with no runtime still reads its manifest floor (`authored?.floor`), not its plan rows.
