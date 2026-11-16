# A data cell's movers stand on the page

TEMPLATE-E2E TC-E5b (opus-brassgun8). A plain data shard in a live grid cell (Mossgate, Brasscap: no client plan) had no
mover collider on the page. Only a `client/plan` mover row (`world.movers`, `scene.motion`) installed followed movers, so the
lift's panel drew rising off the wire while the feet fell through it. `grid/dataCellMovers.ts` now gives each mover its
collider in the cell's region physics, posed off the wire's rows (and placed on replays), and that same row poses the drawn
panel through `wirePage.moverLooks`. When the cell goes, the panel alone takes the wire back. Test: `test/data-cell-movers.test.ts`.
