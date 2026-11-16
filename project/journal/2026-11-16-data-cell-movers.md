# A data cell's movers stand on the page

TEMPLATE-E2E TC-E5b (opus-brassgun8). A plain data shard in a live grid cell (Mossgate, Brasscap: no client plan) had no
mover collider on the page. Only a `client/plan` mover row (`world.movers`, `scene.motion`) installed followed movers, so the
lift's panel drew rising off the wire while the feet fell through it. `grid/dataCellMovers.ts` now gives each mover its
collider in the cell's region physics, posed off the wire's rows (and placed on replays), and that same row poses the drawn
panel through `wirePage.moverLooks`. When the cell goes, the panel alone takes the wire back. Test: `test/data-cell-movers.test.ts`.

Review fixes: a row names its mover by id alone and two copies of one product share ids, so a cell's views take the wire
only when the feet enter it (`claim`), and its panel look is keyed by cell (`moverLookKey`). TC-E6's loot also pays a lone
player in a room (`pageless`: a dedicated room or a CI journey has no page to pay anyone), as a native room does.
